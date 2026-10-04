/**
 * X ChromaBot - ToastViewport
 * Renders the toasts raised through toastStore. Mount once near the app root.
 */

import React, { useSyncExternalStore } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { dismissToast, getToasts, subscribeToasts, ToastKind } from './toastStore.js';

const STYLES: Record<ToastKind, string> = {
  error:
    'bg-red-50 dark:bg-red-950/70 border-red-300 dark:border-red-900 text-red-800 dark:text-red-200',
  success:
    'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-300 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200',
  info: 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-800 dark:text-neutral-200',
};

const ICONS: Record<ToastKind, React.ElementType> = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
};

export const ToastViewport: React.FC = () => {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 left-4 sm:left-auto z-[70] flex flex-col gap-2 sm:w-96 pointer-events-none"
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-2.5 border rounded-xl px-3.5 py-3 shadow-lg text-xs animate-in fade-in slide-in-from-bottom-2 duration-150 ${STYLES[t.kind]}`}
          >
            <Icon className="w-4 h-4 mt-0.5 shrink-0" />
            <p className="flex-1 break-words">{t.message}</p>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss"
              className="shrink-0 opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
