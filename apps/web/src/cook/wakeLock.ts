import { useEffect, useRef } from 'react';

type Sentinel = { release(): Promise<void> };
type WakeLockApi = { request(type: 'screen'): Promise<Sentinel> };

/**
 * Keeps the screen on while cooking (PRD 2.4 step 4) with the Screen Wake Lock API. The browser
 * drops the lock when the app is hidden, so it is asked for again when the app comes back. Where
 * the API is missing or refused, `onUnavailable` runs once per cooking screen (PRD 2.4: "a one-time
 * toast"; D-041).
 */
export function useWakeLock(active: boolean, onUnavailable: () => void): void {
  const warned = useRef(false);
  useEffect(() => {
    if (!active) return;
    const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
    let sentinel: Sentinel | null = null;
    let stopped = false;
    const warn = () => {
      if (warned.current) return;
      warned.current = true;
      onUnavailable();
    };
    const request = async () => {
      if (!api) return warn();
      try {
        const s = await api.request('screen');
        if (stopped) void s.release().catch(() => undefined);
        else sentinel = s;
      } catch {
        warn(); // refused (e.g. battery saver) or not allowed in this frame
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
    };
    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
    // onUnavailable is only a notice: a new identity must not ask for the lock again.
  }, [active]);
}
