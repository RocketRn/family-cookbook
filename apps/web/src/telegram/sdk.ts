import type { TelegramWebApp } from './types';

export type TelegramRuntime = { webApp: TelegramWebApp; mocked: boolean };

let runtime: TelegramRuntime | null = null;
/** In-flight init, shared so concurrent callers (React StrictMode runs effects twice) install the mock once. */
let pending: Promise<TelegramRuntime | null> | null = null;

/** Mirrors Telegram's color scheme and viewport insets into CSS so the design tokens can follow them. */
function syncChrome(webApp: TelegramWebApp): void {
  const root = document.documentElement;
  root.dataset.tgScheme = webApp.colorScheme;
  for (const [k, v] of Object.entries(webApp.themeParams)) {
    if (v) root.style.setProperty(`--tg-theme-${k.replace(/_/g, '-')}`, v);
  }
  // Safe-area insets exist from Bot API 8.0; guard by version, fall back to CSS env().
  if (webApp.isVersionAtLeast('8.0')) {
    const s = webApp.safeAreaInset;
    const c = webApp.contentSafeAreaInset;
    root.style.setProperty('--safe-top', `${(s?.top ?? 0) + (c?.top ?? 0)}px`);
    root.style.setProperty('--safe-bottom', `${(s?.bottom ?? 0) + (c?.bottom ?? 0)}px`);
  }
}

/**
 * Real SDK inside Telegram; in a plain browser during development the mock provider takes over
 * (the real SDK script defines an inert WebApp with an empty initData, so that is the test).
 * Outside Telegram in a production build there is no mock: the caller shows an "open in Telegram" screen.
 */
export function initTelegram(): Promise<TelegramRuntime | null> {
  pending ??= doInit();
  return pending;
}

async function doInit(): Promise<TelegramRuntime | null> {
  if (runtime) return runtime;

  let webApp = window.Telegram?.WebApp;
  let mocked = false;
  if (!webApp?.initData && import.meta.env.DEV) {
    const { installMockWebApp } = await import('./mock');
    webApp = await installMockWebApp();
    mocked = true;
  }
  if (!webApp?.initData) return null;

  webApp.ready();
  webApp.expand();
  webApp.disableVerticalSwipes?.();
  syncChrome(webApp);
  const resync = () => syncChrome(webApp!);
  for (const ev of ['themeChanged', 'safeAreaChanged', 'contentSafeAreaChanged'] as const) {
    webApp.onEvent(ev, resync);
  }
  runtime = { webApp, mocked };
  return runtime;
}

export function getRuntime(): TelegramRuntime {
  if (!runtime) throw new Error('Telegram runtime is not initialised');
  return runtime;
}

export function haptic(kind: 'select' | 'success' | 'error' = 'select'): void {
  const h = runtime?.webApp.HapticFeedback;
  if (!h) return;
  if (kind === 'select') h.selectionChanged();
  else h.notificationOccurred(kind);
}

/** Test helper. */
export function __resetTelegramRuntime(): void {
  runtime = null;
  pending = null;
}
