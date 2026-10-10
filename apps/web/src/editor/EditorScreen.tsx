import type { Lang } from '@cookbook/recipe-core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { recipeApi } from '../api/recipeApi';
import type { ImportWarning, RecipeStatus } from '../api/types';
import { Button } from '../design/Button';
import { Chip } from '../design/Chip';
import { EmptyState, ErrorState, Loading } from '../design/Feedback';
import { TextField } from '../design/Fields';
import { errorMessage } from '../errors';
import { isLanguage, LANGUAGE_NAMES, LANGUAGES } from '../i18n';
import { bookQuery } from '../queries';
import { SYSTEM_TAGS } from '../screens/BookScreen';
import { useLeaveGuard, useToastStore } from '../state/store';
import { haptic, setClosingConfirmation } from '../telegram/sdk';
import {
  check,
  countSuggestions,
  emptyIngredient,
  emptyRecipe,
  emptyStep,
  fromRecipe,
  markSuggested,
  MAX_TAGS,
  move,
  moveIngredient,
  moveToSection,
  removeIngredient,
  reserveKeys,
  sections,
  serverErrors,
  tokenLabels,
  toBody,
  type EdIngredient,
  type EdRecipe,
  type EdStep,
  type Errors,
} from './model';
import { endReview, reviewFor, saveReviewEdits } from './importDraft';
import { IngredientRow, IngredientSheet, LOW_CONFIDENCE, PhotoSlot, StepCard } from './parts';
import { isWaiting } from '../state/online';

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const VISIBILITIES = ['private', 'book', 'link'] as const;

/** What the paste screen passes along (import review, PRD 2.2 step 6). */
export type Imported = {
  original: string;
  warnings: ImportWarning[];
  /** Why the parser was unsure, by ingredient id. */
  reasons: Record<string, string[]>;
};
export type EditorState = { imported?: Imported };

/** FE-04: /recipe/new and /recipe/:id/edit (PRD 2.2 steps 7-10, D-035). */
export function EditorScreen() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const fromImport = (useLocation().state as EditorState | null)?.imported;
  const uiLang: Lang = isLanguage(i18n.language) ? i18n.language : 'en';
  const recipe = useQuery({
    queryKey: ['recipe', id],
    queryFn: () => recipeApi.get(id!),
    enabled: id !== undefined,
  });
  const book = useQuery(bookQuery);

  if (id === undefined) {
    if (isWaiting(book)) return <Loading />;
    return <Editor key="new" initial={emptyRecipe(uiLang, !!book.data)} inBook={!!book.data} />;
  }
  if (isWaiting(recipe) || isWaiting(book)) return <Loading />;
  if (recipe.isError)
    return <ErrorState error={recipe.error} onRetry={() => void recipe.refetch()} />;
  if (!recipe.data) return <EmptyState icon={'🍽️'} title={t('recipe.not_found')} />;
  if (!recipe.data.can_edit) return <EmptyState icon={'🔒'} title={t('editor.not_allowed')} />;
  // FE-05: a review of this recipe in progress on this device continues where it was (D-043).
  const review = reviewFor(recipe.data.id, recipe.data.version);
  const imported: Imported | undefined =
    fromImport ??
    (review
      ? { original: review.original, warnings: review.warnings, reasons: review.reasons }
      : undefined);
  let initial: EdRecipe;
  if (review?.editor) {
    initial = review.editor;
    reserveKeys(initial);
  } else {
    initial = fromRecipe(recipe.data, uiLang);
    if (imported) {
      initial = markSuggested(initial);
      // The import made a private draft by default; "Publish" should still mean "to the book".
      if (book.data && initial.status === 'draft' && initial.visibility === 'private')
        initial.visibility = 'book';
    }
  }
  return <Editor key={id} initial={initial} inBook={!!book.data} imported={imported} />;
}

function Editor({
  initial,
  inBook,
  imported,
}: {
  initial: EdRecipe;
  inBook: boolean;
  imported?: Imported;
}) {
  const { t, i18n } = useTranslation();
  const uiLang: Lang = isLanguage(i18n.language) ? i18n.language : 'en';
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToastStore((s) => s.show);
  const reasons = imported?.reasons;
  const [focusRaw, setFocusRaw] = useState<string | null>(null);
  const [r, setR] = useState(initial);
  const [baseline] = useState(() => JSON.stringify(initial));
  const [errors, setErrors] = useState<Errors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [customTag, setCustomTag] = useState('');
  const dirty = JSON.stringify(r) !== baseline;
  const langs = { recipeLang: r.language, uiLang };
  const labels = useMemo(() => tokenLabels(r.ingredients), [r.ingredients]);
  const lang = r.language;

  // Unsaved changes: the Back button asks first, and so does Telegram before closing the app.
  useEffect(() => {
    useLeaveGuard.getState().set(dirty ? t('editor.leave_confirm') : null);
    setClosingConfirmation(dirty);
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty, t]);
  useEffect(
    () => () => {
      useLeaveGuard.getState().set(null);
      setClosingConfirmation(false);
    },
    [],
  );

  // PRD 4.8: the review is kept on the device as the author goes, until the recipe is saved.
  useEffect(() => {
    if (imported && r.id) saveReviewEdits(r.id, r);
  }, [r]);

  const set = (patch: Partial<EdRecipe>) => setR((x) => ({ ...x, ...patch }));
  const setIng = (key: string, patch: Partial<EdIngredient>) =>
    setR((x) => ({
      ...x,
      ingredients: x.ingredients.map((i) =>
        // A line the author changed is theirs: it is no longer "the parser was not sure".
        i.key === key ? { ...i, ...patch, confidence: null } : i,
      ),
    }));
  const setStep = (key: string, patch: Partial<EdStep>) =>
    setR((x) => ({ ...x, steps: x.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));
  const renameSection = (firstKey: string, group: string) =>
    setR((x) => {
      const block = sections(x.ingredients).find((s) => s.items[0]!.key === firstKey);
      const keys = new Set(block?.items.map((i) => i.key));
      return {
        ...x,
        ingredients: x.ingredients.map((i) => (keys.has(i.key) ? { ...i, group } : i)),
      };
    });

  async function save(status: RecipeStatus) {
    const found = check(r, status === 'published');
    setErrors(found);
    if (Object.keys(found).length > 0) {
      haptic('error');
      setGeneral(t('editor.err_check_fields'));
      return;
    }
    setGeneral(null);
    const { body, ingredientKeys, stepKeys } = toBody(r, status);
    setSaving(true);
    try {
      const saved = r.id ? await recipeApi.update(r.id, body) : await recipeApi.create(body);
      useLeaveGuard.getState().set(null);
      setClosingConfirmation(false);
      endReview(saved.id);
      qc.setQueryData(['recipe', saved.id], saved);
      void qc.invalidateQueries({ queryKey: ['recipes'] });
      haptic('success');
      toast(status === 'published' ? t('editor.published') : t('editor.saved'));
      navigate(`/recipe/${saved.id}`, { replace: true });
    } catch (err) {
      haptic('error');
      const mapped =
        err instanceof ApiError
          ? serverErrors(err.code, err.details, { ingredientKeys, stepKeys })
          : null;
      if (mapped) {
        setErrors(mapped);
        setGeneral(t('editor.err_check_fields'));
      } else setGeneral(errorMessage(t, err));
    } finally {
      setSaving(false);
    }
  }

  const sheetIng = r.ingredients.find((i) => i.key === sheetFor) ?? null;
  const toCheck = r.ingredients.filter(
    (i) => i.confidence !== null && i.confidence < LOW_CONFIDENCE,
  ).length;
  const missing = [
    errors.title ? t('editor.missing_title') : null,
    errors.ingredients ? t('editor.missing_ingredient') : null,
    errors.steps ? t('editor.missing_step') : null,
  ].filter((x): x is string => x !== null);
  const published = r.status === 'published';

  return (
    <ReviewLayout imported={imported} focusRaw={focusRaw}>
      <h1>
        {imported ? t('review.title') : r.id ? t('editor.title_edit') : t('editor.title_new')}
      </h1>
      {imported && (
        <ImportNotice imported={imported} toCheck={toCheck} suggestions={countSuggestions(r)} />
      )}

      <PhotoSlot
        photo={r.cover}
        label={t('editor.add_photo')}
        alt={t('editor.cover_photo')}
        onChange={(cover) => set({ cover })}
      />

      <section className="section stack stack--tight" aria-labelledby="ed-basics">
        <h2 id="ed-basics">{t('editor.basics')}</h2>
        <TextField
          label={t('editor.field_title')}
          value={r.title}
          maxLength={200}
          lang={lang}
          aria-invalid={!!errors.title}
          onChange={(e) => set({ title: e.target.value })}
        />
        {errors.title && (
          <p className="error-text" role="alert">
            {t('editor.err_title')}
          </p>
        )}
        <div className="row row--between">
          <div>
            <div>{t('editor.servings')}</div>
            <div className="hint">{t('editor.servings_hint')}</div>
          </div>
          <div className="row stepper">
            <Button
              variant="secondary"
              aria-label={t('editor.fewer')}
              disabled={r.servings <= 1}
              onClick={() => set({ servings: Math.max(1, Math.ceil(r.servings) - 1) })}
            >
              {'−'}
            </Button>
            <output aria-live="polite" aria-label={t('editor.servings')}>
              {r.servings}
            </output>
            <Button
              variant="secondary"
              aria-label={t('editor.more')}
              disabled={r.servings >= 999}
              onClick={() => set({ servings: Math.floor(r.servings) + 1 })}
            >
              {'+'}
            </Button>
          </div>
        </div>
        <fieldset className="plain">
          <legend className="label">{t('filters.difficulty')}</legend>
          <div className="row row--wrap">
            {DIFFICULTIES.map((d) => (
              <Chip
                key={d}
                selected={r.difficulty === d}
                onToggle={() => set({ difficulty: r.difficulty === d ? null : d })}
              >
                {t(`difficulty.${d}`)}
              </Chip>
            ))}
          </div>
        </fieldset>
        <div className="row">
          <div className="grow">
            <TextField
              label={t('editor.prep_min')}
              value={r.prepMin}
              inputMode="numeric"
              maxLength={5}
              aria-invalid={!!errors.prep}
              onChange={(e) => set({ prepMin: e.target.value })}
            />
          </div>
          <div className="grow">
            <TextField
              label={t('editor.cook_min')}
              value={r.cookMin}
              inputMode="numeric"
              maxLength={5}
              aria-invalid={!!errors.cook}
              onChange={(e) => set({ cookMin: e.target.value })}
            />
          </div>
        </div>
        {(errors.prep || errors.cook) && (
          <p className="error-text" role="alert">
            {t('editor.err_minutes')}
          </p>
        )}
        <fieldset className="plain">
          <legend className="label">{t('editor.language')}</legend>
          <div className="row row--wrap">
            {LANGUAGES.map((l) => (
              <Chip key={l} selected={lang === l} onToggle={() => set({ language: l })} lang={l}>
                {LANGUAGE_NAMES[l]}
              </Chip>
            ))}
          </div>
          <p className="hint">{t('editor.language_hint')}</p>
        </fieldset>
      </section>

      <section className="section stack stack--tight" aria-labelledby="ed-ings">
        <h2 id="ed-ings">{t('recipe.ingredients')}</h2>
        {sections(r.ingredients).map((s) => (
          <div key={s.items[0]!.key} className="stack stack--tight">
            {s.group !== null && (
              <>
                <input
                  className="field field--sm field--section"
                  value={s.group}
                  placeholder={t('editor.section_name')}
                  aria-label={t('editor.section_name')}
                  aria-invalid={!!errors[`section:${s.items[0]!.key}`]}
                  maxLength={100}
                  lang={lang}
                  onChange={(e) => renameSection(s.items[0]!.key, e.target.value)}
                />
                {errors[`section:${s.items[0]!.key}`] && (
                  <p className="error-text" role="alert">
                    {t('editor.err_section')}
                  </p>
                )}
              </>
            )}
            <ul className="edit-lines" lang={lang}>
              {s.items.map((i) => (
                <IngredientRow
                  key={i.key}
                  ing={i}
                  lang={lang}
                  errors={errors}
                  reasons={reasons?.[i.key]}
                  onFocus={() => setFocusRaw(i.rawLine)}
                  onChange={(patch) => setIng(i.key, patch)}
                  onDetails={() => setSheetFor(i.key)}
                />
              ))}
            </ul>
          </div>
        ))}
        {errors.ingredients && (
          <p className="error-text" role="alert">
            {t('editor.err_no_ingredients')}
          </p>
        )}
        <div className="row row--wrap">
          <Button
            variant="ghost"
            disabled={r.ingredients.length >= 100}
            onClick={() =>
              set({
                ingredients: [
                  ...r.ingredients,
                  emptyIngredient(r.ingredients[r.ingredients.length - 1]?.group ?? null),
                ],
              })
            }
          >
            {t('editor.add_ingredient')}
          </Button>
          <Button
            variant="ghost"
            disabled={r.ingredients.length >= 100}
            onClick={() => set({ ingredients: [...r.ingredients, emptyIngredient('')] })}
          >
            {t('editor.add_section')}
          </Button>
        </div>
      </section>

      <section className="stack stack--tight" aria-labelledby="ed-steps">
        <h2 id="ed-steps">{t('recipe.steps')}</h2>
        {r.steps.map((s, n) => (
          <StepCard
            key={s.key}
            step={s}
            n={n + 1}
            count={r.steps.length}
            ingredients={r.ingredients}
            allSteps={r.steps}
            labels={labels}
            langs={langs}
            errors={errors}
            onChange={(patch) => setStep(s.key, patch)}
            onMove={(dir) => set({ steps: move(r.steps, s.key, dir) })}
            onRemove={() => set({ steps: r.steps.filter((x) => x.key !== s.key) })}
          />
        ))}
        {errors.steps && (
          <p className="error-text" role="alert">
            {t('editor.err_no_steps')}
          </p>
        )}
        <Button
          variant="ghost"
          disabled={r.steps.length >= 60}
          onClick={() => set({ steps: [...r.steps, emptyStep()] })}
        >
          {t('editor.add_step')}
        </Button>
      </section>

      <section className="section stack stack--tight" aria-labelledby="ed-notes">
        <h2 id="ed-notes">{t('recipe.author_notes')}</h2>
        <textarea
          className="field textarea"
          value={r.notes}
          maxLength={5000}
          lang={lang}
          aria-labelledby="ed-notes"
          placeholder={t('editor.notes_hint')}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </section>

      <section className="section stack stack--tight" aria-labelledby="ed-tags">
        <h2 id="ed-tags">{t('filters.tags')}</h2>
        <div className="row row--wrap">
          {SYSTEM_TAGS.map((tag) => (
            <Chip
              key={tag}
              selected={r.tags.includes(tag)}
              onToggle={() =>
                set({
                  tags: r.tags.includes(tag) ? r.tags.filter((x) => x !== tag) : [...r.tags, tag],
                })
              }
            >
              {t(`tags.${tag}`)}
            </Chip>
          ))}
          {r.customTags.map((tag) => {
            const text = `${tag} ✕`;
            return (
              <Chip
                key={tag}
                selected
                lang={lang}
                aria-label={t('editor.remove_tag', { name: tag })}
                onToggle={() => set({ customTags: r.customTags.filter((x) => x !== tag) })}
              >
                {text}
              </Chip>
            );
          })}
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            const tag = customTag.trim();
            if (tag && !r.customTags.includes(tag)) set({ customTags: [...r.customTags, tag] });
            setCustomTag('');
          }}
        >
          <div className="grow">
            <TextField
              label={t('editor.custom_tag')}
              placeholder={t('editor.custom_tag_hint')}
              value={customTag}
              maxLength={50}
              lang={lang}
              onChange={(e) => setCustomTag(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            disabled={!customTag.trim() || r.tags.length + r.customTags.length >= MAX_TAGS}
          >
            {t('editor.custom_tag_add')}
          </Button>
        </form>
        {errors.tags && (
          <p className="error-text" role="alert">
            {t('editor.err_tags')}
          </p>
        )}
      </section>

      <section className="section stack stack--tight" aria-labelledby="ed-vis">
        <h2 id="ed-vis">{t('editor.visibility')}</h2>
        <div className="stack stack--tight" role="radiogroup" aria-labelledby="ed-vis">
          {VISIBILITIES.filter((v) => inBook || v === 'private' || v === 'link').map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={r.visibility === v}
              className="option"
              onClick={() => set({ visibility: v })}
            >
              <strong>{t(`recipe.visibility.${v}`)}</strong>
              <span className="hint">{t(`editor.visibility_${v}_hint`)}</span>
            </button>
          ))}
        </div>
      </section>

      <IngredientSheet
        ing={sheetIng}
        lang={lang}
        onChange={(patch) => sheetIng && setIng(sheetIng.key, patch)}
        onMove={(dir) =>
          sheetIng && set({ ingredients: moveIngredient(r.ingredients, sheetIng.key, dir) })
        }
        sections={[
          ...new Set(
            r.ingredients.map((i) => i.group).filter((g): g is string => !!g && !!g.trim()),
          ),
        ]}
        onSection={(group) =>
          sheetIng && set({ ingredients: moveToSection(r.ingredients, sheetIng.key, group) })
        }
        onRemove={() => {
          if (sheetIng) setR((x) => removeIngredient(x, sheetIng.key, langs));
          setSheetFor(null);
        }}
        onClose={() => setSheetFor(null)}
      />

      {general && (
        <p className="error-text" role="alert">
          {missing.length > 0
            ? t('editor.publish_missing', {
                items: new Intl.ListFormat(uiLang, { type: 'conjunction' }).format(missing),
              })
            : general}
        </p>
      )}
      <div className="actionbar row">
        {published ? (
          <Button className="grow" disabled={saving} onClick={() => void save('published')}>
            {saving ? t('editor.saving') : t('editor.save')}
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              className="grow"
              disabled={saving}
              onClick={() => void save('draft')}
            >
              {saving ? t('editor.saving') : t('editor.save_draft')}
            </Button>
            <Button className="grow" disabled={saving} onClick={() => void save('published')}>
              {t('editor.publish')}
            </Button>
          </>
        )}
      </div>
    </ReviewLayout>
  );
}

/**
 * FE-05 review layout (D-043): the original text next to the form on a wide screen, above it
 * (folded) on a phone. The ingredient line in focus is marked in the original.
 */
function ReviewLayout({
  imported,
  focusRaw,
  children,
}: {
  imported: Imported | undefined;
  focusRaw: string | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const details = useRef<HTMLDetailsElement>(null);
  const mark = useRef<HTMLElement>(null);
  useEffect(() => {
    if (details.current && window.matchMedia?.('(min-width: 720px)').matches)
      details.current.open = true;
  }, []);
  useEffect(() => {
    mark.current?.scrollIntoView?.({ block: 'nearest' });
  }, [focusRaw]);
  if (!imported) return <div className="stack">{children}</div>;
  const wanted = focusRaw?.trim();
  let marked = false;
  return (
    <div className="review-layout">
      <aside className="review-layout__original" aria-label={t('review.original')}>
        <details ref={details} className="section">
          <summary>{t('review.original')}</summary>
          <pre className="original-text">
            {imported.original.split('\n').map((line, i) => {
              const hit = !marked && !!wanted && line.trim() === wanted;
              if (hit) marked = true;
              return (
                <span key={i}>
                  {i > 0 && '\n'}
                  {hit ? <mark ref={mark}>{line}</mark> : line}
                </span>
              );
            })}
          </pre>
        </details>
      </aside>
      <div className="stack">{children}</div>
    </div>
  );
}

/** What was done, what to check, and how many suggestions wait for a decision. */
function ImportNotice({
  imported,
  toCheck,
  suggestions,
}: {
  imported: Imported;
  toCheck: number;
  suggestions: number;
}) {
  const { t } = useTranslation();
  return (
    <section className="notice stack stack--tight" aria-label={t('review.title')}>
      {toCheck > 0 ? (
        <>
          <p>{t('review.intro')}</p>
          <p>
            <strong>{t('review.to_check', { count: toCheck })}</strong>
          </p>
        </>
      ) : (
        <p>{t('review.nothing_to_check')}</p>
      )}
      {suggestions > 0 && <p>{t('review.suggestions_left', { count: suggestions })}</p>}
      {imported.warnings.map((w) => (
        <p key={w} className="hint">
          {t(`review.warn_${w}`)}
        </p>
      ))}
    </section>
  );
}
