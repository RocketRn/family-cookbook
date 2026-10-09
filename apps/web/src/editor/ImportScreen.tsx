import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { recipeApi } from '../api/recipeApi';
import { Button } from '../design/Button';
import { errorMessage } from '../errors';
import type { EditorState } from './EditorScreen';
import { IMPORT_DRAFT_KEY, readImportDraft, startReview, writeImportText } from './importDraft';

/** PRD 7.1: an import text is at most 20,000 characters. */
export const IMPORT_MAX_CHARS = 20_000;
export { IMPORT_DRAFT_KEY };

/**
 * PRD 2.2 variant A, steps 1-6: paste, "Parse", then the editor opens on the new private draft as
 * the review (FE-05, D-043). A review not finished yet can be continued from here.
 */
export function ImportScreen() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [text, setText] = useState(() => readImportDraft().text ?? '');
  const [review] = useState(() => readImportDraft().review);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooLong = text.length > IMPORT_MAX_CHARS;

  useEffect(() => writeImportText(text), [text]);

  async function parse() {
    setBusy(true);
    setError(null);
    try {
      const lang = (['ru', 'uk', 'en', 'sv'] as const).find((l) => l === i18n.language) ?? 'en';
      const res = await recipeApi.importText(text, lang);
      const imported = {
        original: text,
        warnings: res.import.warnings,
        reasons: Object.fromEntries(
          res.import.lines.map((l) => [l.ingredient_id, l.reasons] as const),
        ),
      };
      // The text has become a draft recipe; the review in progress is kept instead (D-043).
      startReview({
        recipe_id: res.recipe.id,
        recipe_version: res.recipe.version,
        title: res.recipe.title,
        ...imported,
        editor: null,
      });
      qc.setQueryData(['recipe', res.recipe.id], res.recipe);
      void qc.invalidateQueries({ queryKey: ['recipes'] });
      const state: EditorState = { imported };
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
      {review && (
        <section className="notice stack stack--tight" aria-label={t('review.title')}>
          <p>{t('review.in_progress')}</p>
          <div>
            <Button
              variant="secondary"
              onClick={() => navigate(`/recipe/${review.recipe_id}/edit`)}
            >
              {t('review.continue_checking', { title: review.editor?.title || review.title })}
            </Button>
          </div>
        </section>
      )}
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
