// SWR cache utility: stale-while-revalidate pattern with localStorage
const CACHE_TTL = 30_000; // 30 seconds

const storage = {
  get(key) {
    try {
      const raw = localStorage.getItem(`cache:${key}`);
      if (!raw) return null;
      const { data, timestamp } = JSON.parse(raw);
      return { data, age: Date.now() - timestamp };
    } catch {
      return null;
    }
  },

  set(key, data) {
    try {
      localStorage.setItem(`cache:${key}`, JSON.stringify({
        data,
        timestamp: Date.now(),
      }));
    } catch { /* quota exceeded, ignore */ }
  },

  invalidate(key) {
    localStorage.removeItem(`cache:${key}`);
  },
};

/**
 * SWR fetch: returns cached data immediately if available, refreshes in background.
 * - If fresh cache exists (< TTL): returns cached data, skips network request
 * - If stale cache exists (>= TTL): returns cached data, fetches fresh data and calls onUpdate
 * - If no cache: calls onLoading, fetches data, calls onUpdate
 * - revalidate=true: 忽略 fresh-cache 的短路，始终请求网络（用于必须准确的计数场景）
 */
export async function swrFetch(key, fetchFn, { onUpdate, onLoading, revalidate = false } = {}) {
  const cached = storage.get(key);
  const freshCache = cached && cached.age < CACHE_TTL;

  if (freshCache && !revalidate) {
    onUpdate?.(cached.data);
    return cached.data;
  }

  if (cached) {
    // 先展示旧数据，随后强制刷新。
    onUpdate?.(cached.data);
  } else {
    onLoading?.(true);
  }

  try {
    const freshData = await fetchFn();
    storage.set(key, freshData);
    onUpdate?.(freshData);
    return freshData;
  } catch (err) {
    if (!cached) throw err;
    console.warn(`SWR refresh failed for ${key}, using stale cache:`, err.message);
    return cached.data;
  } finally {
    onLoading?.(false);
  }
}

export function invalidateCache(key) {
  storage.invalidate(key);
}
