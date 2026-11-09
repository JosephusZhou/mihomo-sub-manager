import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api, { refreshApi } from '@/api/client';

// 到期前 60 秒主动续期，避免请求先撞上 401。
const REFRESH_LEEWAY_MS = 60 * 1000;
const MAX_TIMER_DELAY = 2147483647;

// 跨标签页轻量互斥：谁先拿到锁谁负责刷新，其他标签等待结果复用。
const LOCK_KEY = 'auth_refresh_lock';
const LOCK_TTL_MS = 15 * 1000;
const SYNC_KEYS = ['access_token', 'refresh_token', 'user'];

const TAB_ID = (() => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    // ignore
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
})();

function readRefreshLock() {
  try {
    return JSON.parse(localStorage.getItem(LOCK_KEY) || 'null');
  } catch {
    return null;
  }
}

function acquireRefreshLock() {
  const now = Date.now();
  const lock = readRefreshLock();
  if (lock && lock.owner === TAB_ID && lock.expiresAt > now) return true;
  if (lock && lock.expiresAt > now) return false;

  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify({ owner: TAB_ID, expiresAt: now + LOCK_TTL_MS }));
    // 回读确认，降低两个标签同时写入时的竞争概率（localStorage 无原子 CAS）。
    const confirmed = readRefreshLock();
    return !!confirmed && confirmed.owner === TAB_ID && confirmed.expiresAt > now;
  } catch {
    return false;
  }
}

function releaseRefreshLock() {
  if (readRefreshLock()?.owner === TAB_ID) {
    try {
      localStorage.removeItem(LOCK_KEY);
    } catch {
      // ignore
    }
  }
}

function parseTokenExp(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const decoded = atob(padded);
    const bytes = Uint8Array.from(decoded, (ch) => ch.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref(localStorage.getItem('access_token') || '');
  const refreshToken = ref(localStorage.getItem('refresh_token') || '');
  const user = ref(JSON.parse(localStorage.getItem('user') || 'null'));

  const isLoggedIn = computed(() => !!accessToken.value);
  const email = computed(() => user.value?.email || '');
  const apiToken = computed(() => user.value?.api_token || '');

  let refreshTimer = null;
  let refreshPromise = null;

  function clearRefreshTimer() {
    if (refreshTimer !== null) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  }

  function goToLogin() {
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }

  // 只清内存状态，不回写 localStorage，避免触发其他标签页的 storage 事件连锁反应。
  function clearLocalState() {
    clearRefreshTimer();
    accessToken.value = '';
    refreshToken.value = '';
    user.value = null;
  }

  function scheduleRefresh() {
    clearRefreshTimer();
    if (!accessToken.value) return;
    const exp = parseTokenExp(accessToken.value);
    if (!exp) return;
    const delay = Math.min(exp * 1000 - Date.now() - REFRESH_LEEWAY_MS, MAX_TIMER_DELAY);
    refreshTimer = setTimeout(fireScheduledRefresh, Math.max(delay, 0));
  }

  function fireScheduledRefresh() {
    refreshTimer = null;
    if (!accessToken.value) return;
    const exp = parseTokenExp(accessToken.value);
    if (!exp) return;
    if (exp * 1000 - Date.now() <= REFRESH_LEEWAY_MS) {
      ensureRefreshed().catch(() => forceRelogin());
    } else {
      scheduleRefresh();
    }
  }

  // 把 localStorage 中的最新 token 同步回内存；仅在 token 真正变化时重新排期，
  // 避免 user 字段更新或事件重复投递造成重复排期。
  function applyTokensFromStorage() {
    const access = localStorage.getItem('access_token') || '';
    const refreshVal = localStorage.getItem('refresh_token') || '';
    const userRaw = localStorage.getItem('user');
    const tokensChanged = access !== accessToken.value || refreshVal !== refreshToken.value;

    accessToken.value = access;
    refreshToken.value = refreshVal;

    if (userRaw) {
      try {
        user.value = JSON.parse(userRaw);
      } catch {
        user.value = null;
      }
    } else {
      user.value = null;
    }

    if (tokensChanged) {
      if (access) {
        scheduleRefresh();
      } else {
        clearRefreshTimer();
      }
    }
  }

  // storage 事件只会在其他标签页触发；本标签的写入不会回调到这里。
  function handleStorage(event) {
    // key 为 null 表示 localStorage.clear()，同样按当前存储状态重新判断。
    if (event.key !== null && !SYNC_KEYS.includes(event.key)) return;

    const access = localStorage.getItem('access_token') || '';
    const refreshVal = localStorage.getItem('refresh_token') || '';

    // 其他标签登出：清掉本地内存状态并回到登录页，避免继续带旧 token 发请求。
    if (!access && !refreshVal) {
      clearLocalState();
      clearSwrCaches();
      goToLogin();
      return;
    }

    applyTokensFromStorage();
  }

  // 等待持有刷新锁的标签写入新 token；锁过期或标签崩溃时返回 timeout 以便接管。
  function waitForOtherTabRefresh(previousRefreshToken) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        const access = localStorage.getItem('access_token') || '';
        const refreshVal = localStorage.getItem('refresh_token') || '';

        if (!access && !refreshVal) {
          clearInterval(timer);
          resolve('logout');
          return;
        }
        if (refreshVal && refreshVal !== previousRefreshToken) {
          clearInterval(timer);
          resolve('updated');
          return;
        }
        if (Date.now() - startedAt >= LOCK_TTL_MS) {
          clearInterval(timer);
          resolve('timeout');
        }
      }, 100);
    });
  }

  async function acquireLockOrWait(currentRefresh) {
    // 最多两轮：首轮等锁持有者；超时后再尝试接管一次，避免标签崩溃后永久卡住。
    for (let attempt = 0; attempt < 2; attempt++) {
      if (acquireRefreshLock()) return 'locked';
      const waited = await waitForOtherTabRefresh(currentRefresh);
      if (waited === 'updated') return 'reused';
      if (waited === 'logout') return 'ended';
    }
    return 'busy';
  }

  async function refresh() {
    const currentRefresh = refreshToken.value;
    if (!currentRefresh) throw new Error('No refresh token');

    const outcome = await acquireLockOrWait(currentRefresh);
    if (outcome === 'reused') {
      applyTokensFromStorage();
      return { access_token: accessToken.value, refresh_token: refreshToken.value };
    }
    if (outcome === 'ended') throw new Error('Session ended');
    if (outcome === 'busy') throw new Error('Refresh lock busy');

    try {
      const { data } = await refreshApi.post(
        '/auth/refresh',
        { refresh_token: currentRefresh },
        { skipAuthRefresh: true }
      );
      // 刷新期间已登出或重新登录时，丢弃这次刷新结果。
      if (refreshToken.value === currentRefresh) {
        setTokens(data.access_token, data.refresh_token);
      }
      return data;
    } finally {
      releaseRefreshLock();
    }
  }

  function ensureRefreshed() {
    // 单飞：并发 401 共享同一次刷新，结束后清空以便下次重新发起。
    if (!refreshPromise) {
      refreshPromise = refresh().finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  }

  function setTokens(access, refreshVal) {
    accessToken.value = access;
    refreshToken.value = refreshVal;
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refreshVal);
    scheduleRefresh();
  }

  function setUser(userData) {
    user.value = userData;
    localStorage.setItem('user', JSON.stringify(userData));
  }

  async function login(emailVal, password) {
    const { data } = await api.post(
      '/auth/login',
      { email: emailVal, password },
      { skipAuthRefresh: true }
    );
    setTokens(data.access_token, data.refresh_token);
    setUser(data.user);
    return data;
  }

  async function fetchMe() {
    const { data } = await api.get('/auth/me');
    setUser(data.user);
    return data.user;
  }

  async function regenerateApiToken() {
    const { data } = await api.post('/auth/regenerate-token');
    setUser({ ...(user.value || {}), api_token: data.api_token });
    return data.api_token;
  }

  // 用户维度的 SWR 缓存必须在所有登出路径清理，避免切换账号后读到上一个用户的数据。
  function clearSwrCaches() {
    for (const key of ['proxies', 'chainedProxies', 'paidSubs', 'templates', 'profiles', 'customRules']) {
      localStorage.removeItem(`cache:${key}`);
    }
  }

  function logout() {
    clearLocalState();
    releaseRefreshLock();
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    clearSwrCaches();
  }

  function forceRelogin() {
    logout();
    goToLogin();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      // 隐藏时停掉定时器，避免后台节流导致延迟触发；回到前台时重新判断。
      clearRefreshTimer();
      return;
    }
    if (!accessToken.value) return;
    const exp = parseTokenExp(accessToken.value);
    if (!exp) return;
    if (exp * 1000 - Date.now() <= REFRESH_LEEWAY_MS) {
      ensureRefreshed().catch(() => forceRelogin());
    } else {
      scheduleRefresh();
    }
  }

  function handlePageHide(event) {
    clearRefreshTimer();
    // 非 bfcache 的真实关闭：释放本标签持有的刷新锁，避免占满 TTL。
    if (!event.persisted) releaseRefreshLock();
  }

  function handlePageShow() {
    if (accessToken.value) scheduleRefresh();
  }

  window.addEventListener('storage', handleStorage);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('pageshow', handlePageShow);

  // 页面带着旧 token 重新加载时，按 exp 决定立即刷新还是排期。
  if (accessToken.value) scheduleRefresh();

  return {
    accessToken, refreshToken, user,
    isLoggedIn, email, apiToken,
    login, refresh, ensureRefreshed, fetchMe, regenerateApiToken, logout, forceRelogin,
  };
});
