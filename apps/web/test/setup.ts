import { webcrypto } from 'node:crypto';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { EMPTY_FILTERS } from '../src/api/recipes';
import { useFilterStore, useLeaveGuard } from '../src/state/store';

// jsdom has no WebCrypto subtle API; Node's is identical to the browser's.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

afterEach(() => {
  cleanup();
  // The filter store is app-wide state: a search typed in one test must not leak into the next.
  useFilterStore.setState({ filters: EMPTY_FILTERS });
  useLeaveGuard.setState({ message: null });
  window.history.replaceState({}, '', '/');
  document.documentElement.removeAttribute('data-tg-scheme');
  localStorage.clear();
  delete window.Telegram;
  // The dev mock's back button is plain DOM outside React; remove it so tests never click a stale one.
  document.querySelectorAll('[data-testid=mock-back-button]').forEach((el) => el.remove());
});
