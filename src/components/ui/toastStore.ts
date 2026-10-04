/**
 * X ChromaBot - toast store
 * Tiny module-level pub/sub so non-React code (the API client) can raise toasts.
 */

export type ToastKind = 'error' | 'success' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const DEFAULT_TTL_MS = 6000;

let nextId = 1;
let toasts: ToastItem[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Shows a toast. An identical message already on screen is not duplicated (polling-safe). */
export function showToast(message: string, kind: ToastKind = 'info', ttlMs = DEFAULT_TTL_MS): void {
  if (toasts.some((t) => t.message === message && t.kind === kind)) return;
  const id = nextId++;
  toasts = [...toasts, { id, kind, message }].slice(-4);
  emit();
  setTimeout(() => dismissToast(id), ttlMs);
}

export const toast = {
  error: (m: string) => showToast(m, 'error'),
  success: (m: string) => showToast(m, 'success'),
  info: (m: string) => showToast(m, 'info'),
};

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToasts(): ToastItem[] {
  return toasts;
}
