import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { recipeApi } from '../api/recipeApi';
import { Button } from '../design/Button';
import { errorMessage } from '../errors';
import type { EditorState } from './EditorScreen';

/** PRD 7.1: an import text is at most 20,000 characters. */
export const IMPORT_MAX_CHARS = 20_000;
/** PRD 4.8 localStorage key: the pasted text survives closing the app until the recipe is saved. */
export const IMPORT_DRAFT_KEY = 'import-draft';

function readDraft(): string {
  try {
    const v = JSON.parse(localStorage.getItem(IMPORT_DRAFT_KEY) ?? 'null') as { text?: unknown };
    return typeof v?.text === 'string' ? v.text : '';
  } catch {
    return '';
  }
}
function writeDraft(text: string): void {
  try {
    if (text) localStorage.setItem(IMPORT_DRAFT_KEY, JSON.stringify({ v: 1, text }));
    else localStorage.removeItem(IMPORT_DRAFT_KEY);
  } catch {
    /* private mode or storage full: the text simply is not kept */
  }
}

/**
 * PRD 2.2 variant A, steps 1-6 (thin version, owner decision 1): paste, "Parse", then the editor
 * opens on the new private draft with uncertain lines highlighted. The full review screen is FE-05.
 */
export function ImportScreen() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [text, setText] = useState(readDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooLong = text.length > IMPORT_MAX_CHARS;

  useEffect(() => writeDraft(text), [text]);

  async function parse() {
    setBusy(true);
    setError(null);
    try {
      const lang = (['ru', 'uk', 'en', 'sv'] as const).find((l) => l === i18n.language) ?? 'en';
      const res = await recipeApi.importText(text, lang);
      writeDraft('');
      qc.setQueryData(['recipe', res.recipe.id], res.recipe);
      void qc.invalidateQueries({ queryKey: ['recipes'] });
      const state: EditorState = {
        imported: {
          original: text,
          warnings: res.import.warnings,
          reasons: Object.fromEntries(
            res.import.lines.map((l) => [l.ingredient_id, l.reasons] as const),
          ),
        },
      };
      navigate(`/recipe/${res.recipe.id}/edit`, { replace: true, state });
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h1>{t('import.title')}</h1>
      <p className="hint">{t('import.hint')}</p>
      <textarea
        className="field textarea textarea--tall"
        value={text}
        aria-label={t('import.title')}
        aria-invalid={tooLong}
        placeholder={t('import.placeholder')}
        onChange={(e) => setText(e.target.value)}
      />
      <p className={tooLong ? 'error-text' : 'hint'} aria-live="polite">
        {tooLong
          ? t('import.too_long', { max: IMPORT_MAX_CHARS.toLocaleString(i18n.language) })
          : t('import.counter', {
              used: text.length.toLocaleString(i18n.language),
              max: IMPORT_MAX_CHARS.toLocaleString(i18n.language),
            })}
      </p>
      <p className="hint">{t('import.kept')}</p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="actionbar row">
        <Button
          className="grow"
          disabled={busy || !text.trim() || tooLong}
          onClick={() => void parse()}
        >
          {busy ? t('import.parsing') : t('import.parse')}
        </Button>
      </div>
    </div>
  );
}
