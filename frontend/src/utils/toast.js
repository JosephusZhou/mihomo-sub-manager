// 统一 Toast 提示：toast.success / error / info，配合 App.vue 中的 ToastContainer。
import { reactive } from 'vue';

let seq = 0;

export const toastState = reactive({ items: [] });

function dismiss(id) {
  const index = toastState.items.findIndex(item => item.id === id);
  if (index !== -1) toastState.items.splice(index, 1);
}

function push(type, message, duration) {
  const id = ++seq;
  toastState.items.push({ id, type, message: String(message) });
  window.setTimeout(() => dismiss(id), duration);
  return id;
}

export const toast = {
  success: (message) => push('success', message, 3000),
  error: (message) => push('error', message, 4000),
  info: (message) => push('info', message, 3000),
};

export function dismissToast(id) {
  dismiss(id);
}

export function errorMessage(err, fallback = '操作失败') {
  return (err && err.response && err.response.data && err.response.data.error)
    || (err && err.message)
    || fallback;
}

// 复制成功/失败都给出提示，避免各处静默调用。
export async function copyText(text, successMessage = '已复制到剪贴板') {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
    return true;
  } catch {
    toast.error('复制失败，请手动复制');
    return false;
  }
}
