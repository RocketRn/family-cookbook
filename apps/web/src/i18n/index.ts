import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ru from './locales/ru.json';
import sv from './locales/sv.json';
import uk from './locales/uk.json';

export const LANGUAGES = ['ru', 'uk', 'en', 'sv'] as const;
export type Language = (typeof LANGUAGES)[number];
export const LANGUAGE_NAMES: Record<Language, string> = {
  ru: 'Русский',
  uk: 'Українська',
  en: 'English',
  sv: 'Svenska',
};

const STORAGE_KEY = 'ui_lang';

export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v);
}

/** PRD 4.3 mapping: ru, uk, en, sv; anything else falls back to en. */
export function languageFromTelegram(code: string | undefined): Language {
  const primary = code?.toLowerCase().split(/[-_]/)[0];
  return LANGUAGES.find((l) => l === primary) ?? 'en';
}

/** Manual choice > server profile language > Telegram language_code > English. */
export function resolveLanguage(o: {
  manual?: string | null;
  server?: string | null;
  tgCode?: string;
}): Language {
  if (isLanguage(o.manual)) return o.manual;
  if (isLanguage(o.server)) return o.server;
  return languageFromTelegram(o.tgCode);
}

export function readManualLanguage(): Language | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLanguage(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveManualLanguage(lang: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage may be unavailable in some WebViews: the choice then lasts for the session only */
  }
}

export async function setLanguage(lang: Language): Promise<void> {
  document.documentElement.lang = lang;
  await i18n.changeLanguage(lang);
  document.title = i18n.t('app_name');
}

void i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
    uk: { translation: uk },
    en: { translation: en },
    sv: { translation: sv },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
