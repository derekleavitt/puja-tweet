/**
 * X ChromaBot - ConfirmDialog
 * In-app replacement for window.confirm().
 */

import React from 'react';
import { AlertCircle } from 'lucide-react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  message,
  confirmLabel = 'Confirm',
  destructive = false,
  onConfirm,
  onCancel,
}) => (
  <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
    <div
      role="alertdialog"
      aria-modal="true"
      className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4"
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle
          className={`w-4 h-4 mt-0.5 shrink-0 ${destructive ? 'text-red-500' : 'text-amber-500'}`}
        />
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">{title}</h3>
          <p className="text-xs text-neutral-600 dark:text-neutral-400">{message}</p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 text-xs">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          autoFocus
          onClick={onConfirm}
          className={`px-3 py-1.5 rounded-lg font-semibold text-white transition-colors cursor-pointer shadow-xs ${
            destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);
