import { webcrypto } from 'node:crypto';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no WebCrypto subtle API; Node's is identical to the browser's.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  document.documentElement.removeAttribute('data-tg-scheme');
  localStorage.clear();
  delete window.Telegram;
  // The dev mock's back button is plain DOM outside React; remove it so tests never click a stale one.
  document.querySelectorAll('[data-testid=mock-back-button]').forEach((el) => el.remove());
});
