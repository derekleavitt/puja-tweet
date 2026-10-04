/**
 * X ChromaBot - usePolling
 * Calls the latest `callback` every `intervalMs` while `enabled` and the page
 * is visible. Polling pauses when the tab is hidden and fires once immediately
 * when it becomes visible again.
 */

import { useEffect, useRef } from 'react';

/** Pure policy: poll only when enabled and the document is not hidden. */
export function shouldPoll(enabled: boolean, visibilityState: string): boolean {
  return enabled && visibilityState !== 'hidden';
}

export function usePolling(callback: () => void, intervalMs: number, enabled: boolean = true) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const sync = (catchUp: boolean) => {
      if (shouldPoll(enabled, document.visibilityState)) {
        if (timer === null) {
          if (catchUp) callbackRef.current();
          timer = setInterval(() => callbackRef.current(), intervalMs);
        }
      } else {
        stop();
      }
    };
    const onVisibility = () => sync(true);

    sync(false);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [intervalMs, enabled]);
}
