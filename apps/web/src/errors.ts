import type { TFunction } from 'i18next';
import { ApiError } from './api/client';

/** User-facing message for any error, from i18n keys only. */
export function errorMessage(t: TFunction, err: unknown): string {
  const code = err instanceof ApiError ? err.code : 'INTERNAL';
  return t(`errors.${code}`, { defaultValue: t('errors.INTERNAL') });
}
