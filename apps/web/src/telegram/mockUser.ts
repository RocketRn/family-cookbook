import type { TelegramUser } from './types';

/** Dev users; ids match db/seeds/dev.sql. Pick one with `?devUser=2` in the URL. */
export const MOCK_USERS: Record<string, TelegramUser> = {
  '1': {
    id: 100000001,
    first_name: 'Dev Keeper',
    username: 'dev_keeper',
    language_code: 'ru',
    allows_write_to_pm: true,
  },
  '2': {
    id: 100000002,
    first_name: 'Dev Member',
    username: 'dev_member',
    language_code: 'en',
    allows_write_to_pm: true,
  },
  '3': {
    id: 100000003,
    first_name: 'Ny Användare',
    username: 'dev_new',
    language_code: 'sv',
    allows_write_to_pm: false,
  },
};

export const DEFAULT_DEV_TOKEN = '000000:DEV-ONLY-FAKE-TOKEN';
