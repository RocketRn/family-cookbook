import { DEFAULT_DEV_TOKEN, MOCK_USERS } from './mockUser';
import { signInitData } from './signing';
import type { TelegramWebApp, ThemeParams, WebAppEvent } from './types';

/**
 * Telegram SDK mock for plain-browser development (`pnpm dev`, no bot needed).
 * Loaded only from a `import.meta.env.DEV` branch, so it is not part of production bundles.
 */

const LIGHT: ThemeParams = {
  bg_color: '#ffffff',
  text_color: '#000000',
  hint_color: '#707579',
  link_color: '#2481cc',
  button_color: '#3390ec',
  button_text_color: '#ffffff',
  secondary_bg_color: '#f4f4f5',
  header_bg_color: '#ffffff',
  accent_text_color: '#2481cc',
  section_bg_color: '#ffffff',
  destructive_text_color: '#e53935',
};

const DARK: ThemeParams = {
  bg_color: '#17212b',
  text_color: '#f5f5f5',
  hint_color: '#708499',
  link_color: '#6ab3f3',
  button_color: '#5288c1',
  button_text_color: '#ffffff',
  secondary_bg_color: '#232e3c',
  header_bg_color: '#17212b',
  accent_text_color: '#6ab3f3',
  section_bg_color: '#17212b',
  destructive_text_color: '#ec3942',
};

function applyThemeVars(params: ThemeParams): void {
  for (const [k, v] of Object.entries(params)) {
    if (v) document.documentElement.style.setProperty(`--tg-theme-${k.replace(/_/g, '-')}`, v);
  }
}

/** A visible stand-in for Telegram's native back button, which does not exist in a browser. */
function mockBackButtonElement(onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = '‹ Back (mock BackButton)';
  el.setAttribute('data-testid', 'mock-back-button');
  Object.assign(el.style, {
    position: 'fixed',
    top: '4px',
    left: '4px',
    zIndex: '9999',
    minHeight: '44px',
    padding: '0 12px',
    borderRadius: '12px',
    border: '1px dashed currentColor',
    background: 'var(--tg-theme-bg-color)',
    color: 'var(--tg-theme-text-color)',
    display: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  el.addEventListener('click', onClick);
  document.body.appendChild(el);
  return el;
}

export async function installMockWebApp(): Promise<TelegramWebApp> {
  const query = new URLSearchParams(window.location.search);
  const user = MOCK_USERS[query.get('devUser') ?? '1'] ?? MOCK_USERS['1']!;
  const scheme: 'light' | 'dark' =
    query.get('theme') === 'dark' ||
    (query.get('theme') !== 'light' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
      ? 'dark'
      : 'light';
  const token = import.meta.env.VITE_DEV_BOT_TOKEN ?? DEFAULT_DEV_TOKEN;

  const initData = await signInitData(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: 'MOCK_QUERY',
      user: JSON.stringify(user),
      ...(query.get('startapp') ? { start_param: query.get('startapp')! } : {}),
    },
    token,
  );

  const listeners = new Map<WebAppEvent, Set<() => void>>();
  const backHandlers = new Set<() => void>();
  const backEl = mockBackButtonElement(() => backHandlers.forEach((h) => h()));
  const mainHandlers = new Set<() => void>();

  const themeParams = scheme === 'dark' ? DARK : LIGHT;
  applyThemeVars(themeParams);

  const app: TelegramWebApp = {
    initData,
    initDataUnsafe: {
      user,
      auth_date: Math.floor(Date.now() / 1000),
      ...(query.get('startapp') ? { start_param: query.get('startapp')! } : {}),
    },
    version: '9.0',
    platform: 'mock',
    colorScheme: scheme,
    themeParams,
    isExpanded: true,
    viewportHeight: window.innerHeight,
    viewportStableHeight: window.innerHeight,
    safeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
    contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
    BackButton: {
      isVisible: false,
      show() {
        this.isVisible = true;
        backEl.style.display = 'block';
      },
      hide() {
        this.isVisible = false;
        backEl.style.display = 'none';
      },
      onClick: (cb) => backHandlers.add(cb),
      offClick: (cb) => backHandlers.delete(cb),
    },
    MainButton: {
      text: '',
      isVisible: false,
      setText(text) {
        this.text = text;
      },
      show() {
        this.isVisible = true;
      },
      hide() {
        this.isVisible = false;
      },
      onClick: (cb) => mainHandlers.add(cb),
      offClick: (cb) => mainHandlers.delete(cb),
    },
    HapticFeedback: {
      impactOccurred: (s) => console.debug('[mock haptic] impact', s),
      notificationOccurred: (t) => console.debug('[mock haptic] notification', t),
      selectionChanged: () => console.debug('[mock haptic] selection'),
    },
    ready: () => undefined,
    expand: () => undefined,
    close: () => console.debug('[mock] close()'),
    isVersionAtLeast: () => true,
    disableVerticalSwipes: () => undefined,
    requestWriteAccess: (cb) => cb?.(true),
    shareMessage: (_id, cb) => cb?.(true),
    openTelegramLink: (url) => window.open(url, '_blank', 'noopener'),
    openLink: (url) => window.open(url, '_blank', 'noopener'),
    onEvent(event, cb) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
    },
    offEvent: (event, cb) => listeners.get(event)?.delete(cb),
  };

  window.Telegram = { WebApp: app };
  return app;
}
