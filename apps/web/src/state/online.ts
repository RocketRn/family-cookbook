import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

/**
 * S6-6: whether the phone has a connection, as the browser reports it ("online" / "offline"
 * events). The same signal that pauses loading, so the note and the loads always agree.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
  );
}

/**
 * Nothing to show yet: loading, or waiting for the connection to load. TanStack's `isLoading`
 * is false while a load waits for the connection, which made such a screen look empty or "not
 * found" (S6-6).
 */
export function isWaiting(q: { isLoading: boolean; isPending: boolean; fetchStatus: string }) {
  return q.isLoading || (q.isPending && q.fetchStatus === 'paused');
}
