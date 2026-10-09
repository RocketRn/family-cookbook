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
  // Match Telegram's header and background to the app's page colour (Bot API 6.1+; A-19).
  if (webApp.isVersionAtLeast('6.1')) {
    try {
      webApp.setHeaderColor?.('secondary_bg_color');
      webApp.setBackgroundColor?.('secondary_bg_color');
    } catch {
      /* an older client rejecting the keyword is cosmetic only */
    }
  }
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

export function haptic(kind: 'select' | 'success' | 'warning' | 'error' = 'select'): void {
  const h = runtime?.webApp.HapticFeedback;
  if (!h) return;
  if (kind === 'select') h.selectionChanged();
  else h.notificationOccurred(kind);
}

/** A yes / no question: Telegram's own dialog (Bot API 6.2+), else the browser's. */
export function confirmDialog(message: string): Promise<boolean> {
  const app = runtime?.webApp;
  if (app?.showConfirm && app.isVersionAtLeast('6.2')) {
    return new Promise((resolve) => app.showConfirm!(message, resolve));
  }
  return Promise.resolve(window.confirm(message));
}

/**
 * PRD 4.5: asks the user to let the bot write to them (Bot API 6.9+). Resolves false when refused,
 * and null when this Telegram client cannot ask.
 */
export function requestWriteAccess(): Promise<boolean | null> {
  const app = runtime?.webApp;
  if (!app?.isVersionAtLeast('6.9')) return Promise.resolve(null);
  return new Promise((resolve) => app.requestWriteAccess((granted) => resolve(granted)));
}

/** Telegram asks before closing the Mini App while this is on (Bot API 6.2+). */
export function setClosingConfirmation(on: boolean): void {
  const app = runtime?.webApp;
  if (!app?.isVersionAtLeast('6.2')) return;
  if (on) app.enableClosingConfirmation?.();
  else app.disableClosingConfirmation?.();
}

/** Test helper. */
export function __resetTelegramRuntime(): void {
  runtime = null;
  pending = null;
}
