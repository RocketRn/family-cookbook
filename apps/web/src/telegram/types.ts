/** The subset of the Telegram Mini Apps WebApp surface this app uses. */
export type ThemeParams = Partial<
  Record<
    | 'bg_color'
    | 'text_color'
    | 'hint_color'
    | 'link_color'
    | 'button_color'
    | 'button_text_color'
    | 'secondary_bg_color'
    | 'header_bg_color'
    | 'accent_text_color'
    | 'section_bg_color'
    | 'section_header_text_color'
    | 'subtitle_text_color'
    | 'destructive_text_color',
    string
  >
>;

export type TelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  allows_write_to_pm?: boolean;
};

export type Inset = { top: number; bottom: number; left: number; right: number };

export interface WebAppBackButton {
  isVisible: boolean;
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

export interface WebAppMainButton {
  text: string;
  isVisible: boolean;
  setText(text: string): void;
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

export interface WebAppHaptics {
  impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
  notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  selectionChanged(): void;
}

export type WebAppEvent =
  'themeChanged' | 'viewportChanged' | 'safeAreaChanged' | 'contentSafeAreaChanged';

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: TelegramUser; start_param?: string; auth_date?: number };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: ThemeParams;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  safeAreaInset?: Inset;
  contentSafeAreaInset?: Inset;
  BackButton: WebAppBackButton;
  MainButton: WebAppMainButton;
  HapticFeedback: WebAppHaptics;
  ready(): void;
  expand(): void;
  close(): void;
  isVersionAtLeast(version: string): boolean;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  disableVerticalSwipes?(): void;
  requestWriteAccess(cb?: (granted: boolean) => void): void;
  shareMessage(id: string, cb?: (sent: boolean) => void): void;
  openTelegramLink(url: string): void;
  openLink(url: string): void;
  onEvent(event: WebAppEvent, cb: () => void): void;
  offEvent(event: WebAppEvent, cb: () => void): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}
