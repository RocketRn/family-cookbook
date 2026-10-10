import { findDurations, unitLabel, type Lang } from '@cookbook/recipe-core';
import { useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { recipeApi } from '../api/recipeApi';
import type { Photo } from '../api/types';
import { BottomSheet } from '../design/BottomSheet';
import { Button } from '../design/Button';
import { Chip } from '../design/Chip';
import { TextField } from '../design/Fields';
import { errorMessage } from '../errors';
import { haptic } from '../telegram/sdk';
import {
  amountPreview,
  canonicalText,
  defaultShare,
  displayText,
  insertion,
  newKey,
  numberInput,
  previewText,
  SHARE_CHOICES,
  unitChoices,
  usedShare,
  type EdIngredient,
  type EdStep,
  type EdTimer,
  type Errors,
} from './model';
import { PHOTO_ACCEPT, PhotoError, preparePhoto, uploadName } from './photos';

export type Langs = { recipeLang: Lang; uiLang: Lang };

/* ---------------------------------------------------------------- photos */

/**
 * Cover or step photo: pick (JPEG / PNG / WebP only), make smaller on the device, upload to
 * POST /media, then show it. The recipe keeps only the photo id until it is saved.
 */
export function PhotoSlot({
  photo,
  onChange,
  label,
  alt,
  small = false,
}: {
  photo: Photo | null;
  onChange: (p: Photo | null) => void;
  /** The text of the empty slot. */
  label: string;
  /** What the photo shows, once there is one. */
  alt: string;
  small?: boolean;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const prepared = await preparePhoto(file);
      onChange(await recipeApi.uploadPhoto(prepared, uploadName(file, prepared)));
    } catch (err) {
      haptic('error');
      setError(err instanceof PhotoError ? t(`errors.${err.code}`) : errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  const fileInput = (
    <input
      ref={input}
      type="file"
      accept={PHOTO_ACCEPT}
      hidden
      aria-label={label}
      data-testid="photo-input"
      onChange={(e) => void pick(e)}
    />
  );

  return (
    <div className="stack stack--tight">
      {fileInput}
      {photo ? (
        <div className="row row--wrap">
          <img
            className={small ? 'edit-photo edit-photo--small' : 'edit-photo'}
            src={photo.thumb_url}
            alt={alt}
          />
          <div className="stack stack--tight">
            <Button variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? t('editor.photo_uploading') : t('editor.change_photo')}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => onChange(null)}>
              {t('editor.remove_photo')}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={small ? 'slot slot--small' : 'slot'}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <span aria-hidden="true">{'＋'}</span>
          <span>{busy ? t('editor.photo_uploading') : label}</span>
          {!small && <span className="hint">{t('editor.photo_hint')}</span>}
        </button>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- one ingredient line */

const KINDS = ['amount', 'to_taste', 'pinch'] as const;

export function unitText(i: EdIngredient, lang: Lang, noUnit: string): string {
  if (i.unitCode) return unitLabel(i.unitCode, lang, 1) ?? i.unitCode;
  return i.unitRaw.trim() || noUnit;
}

/** PRD 5.1.3: the parser was not sure about this line; the review highlights it. */
export const LOW_CONFIDENCE = 0.7;

export function IngredientRow({
  ing,
  lang,
  errors,
  reasons,
  onFocus,
  onChange,
  onDetails,
}: {
  ing: EdIngredient;
  lang: Lang;
  errors: Errors;
  reasons?: string[];
  /** The import review marks this line in the original text (FE-05). */
  onFocus?: () => void;
  onChange: (patch: Partial<EdIngredient>) => void;
  onDetails: () => void;
}) {
  const { t } = useTranslation();
  const nameError = errors[`ing:${ing.key}:name`];
  const amountError = errors[`ing:${ing.key}:amount`];
  const low = ing.confidence !== null && ing.confidence < LOW_CONFIDENCE;
  const noAmount = ing.kind === 'to_taste' || ing.kind === 'pinch';
  return (
    <li className={low ? 'edit-line edit-line--low' : 'edit-line'} data-testid="ingredient-row">
      <div className="row">
        <input
          className="field field--sm grow"
          value={ing.name}
          aria-label={t('editor.ingredient_name')}
          aria-invalid={!!nameError}
          maxLength={200}
          lang={lang}
          onFocus={onFocus}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        {noAmount ? (
          <button type="button" className="chip chip--unit chip--qty" onClick={onDetails}>
            {t(`editor.qty_${ing.kind}`)}
          </button>
        ) : (
          <>
            <input
              className="field field--sm field--amount"
              value={ing.amount}
              inputMode="decimal"
              aria-label={t('editor.amount')}
              aria-invalid={!!amountError}
              maxLength={20}
              onFocus={onFocus}
              onChange={(e) =>
                onChange({
                  amount: e.target.value,
                  ...(e.target.value.trim() && ing.kind !== 'exact' && ing.kind !== 'range'
                    ? { kind: 'exact' as const }
                    : {}),
                })
              }
            />
            <button
              type="button"
              className="chip chip--unit"
              aria-label={t('editor.ingredient_details')}
              onClick={onDetails}
            >
              {unitText(ing, lang, t('editor.no_unit'))}
            </button>
          </>
        )}
      </div>
      {/* Said once: the import's reasons already say it for a highlighted line. */}
      {ing.kind === 'unparsed' && !(low && reasons?.includes('unparsed')) && (
        <p className="hint">{t('review.reason_unparsed')}</p>
      )}
      {low && reasons && reasons.length > 0 && (
        <ul className="edit-line__reasons hint">
          {reasons.map((r) => (
            <li key={r}>{t(`review.reason_${r}`)}</li>
          ))}
        </ul>
      )}
      {nameError && (
        <p className="error-text" role="alert">
          {t('editor.err_name')}
        </p>
      )}
      {amountError && (
        <p className="error-text" role="alert">
          {t('editor.err_amount')}
        </p>
      )}
    </li>
  );
}

/** Details of one line: kind of quantity, unit, optional, note, order, remove. */
export function IngredientSheet({
  ing,
  lang,
  onChange,
  onMove,
  sections = [],
  onSection,
  onRemove,
  onClose,
}: {
  ing: EdIngredient | null;
  lang: Lang;
  onChange: (patch: Partial<EdIngredient>) => void;
  onMove: (dir: -1 | 1) => void;
  /** Named sections of the recipe; the line can move to any of them (FE-05). */
  sections?: string[];
  onSection?: (group: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!ing) return null;
  const kind = ing.kind === 'exact' || ing.kind === 'range' ? 'amount' : ing.kind;
  const counted = kind === 'amount' || kind === 'unparsed';
  return (
    <BottomSheet open title={t('editor.ingredient_details')} onClose={onClose}>
      <div className="stack">
        <p className="label" lang={lang}>
          {ing.name || t('editor.ingredient_name')}
        </p>
        <fieldset className="plain">
          <legend className="label">{t('editor.qty_kind')}</legend>
          <div className="row row--wrap">
            {KINDS.map((k) => (
              <Chip
                key={k}
                selected={kind === k}
                onToggle={() =>
                  onChange(
                    k === 'amount'
                      ? { kind: 'exact' }
                      : { kind: k, amount: '', unitCode: null, unitRaw: '' },
                  )
                }
              >
                {k === 'amount' ? t('editor.amount') : t(`editor.qty_${k}`)}
              </Chip>
            ))}
            {ing.kind === 'unparsed' && (
              <Chip selected disabled>
                {t('editor.qty_unparsed')}
              </Chip>
            )}
          </div>
          {kind === 'amount' && <p className="hint">{t('editor.amount_hint')}</p>}
        </fieldset>
        {counted && (
          <fieldset className="plain">
            <legend className="label">{t('editor.unit')}</legend>
            {/* Unit names come from recipe-core UNITS, in the recipe's language (D-021). */}
            <div className="row row--wrap" lang={lang}>
              <Chip selected={ing.unitCode === null} onToggle={() => onChange({ unitCode: null })}>
                {t('editor.no_unit')}
              </Chip>
              {unitChoices(lang, ing.unitCode).map((code) => (
                <Chip
                  key={code}
                  selected={ing.unitCode === code}
                  onToggle={() => onChange({ unitCode: code, unitRaw: '' })}
                >
                  {unitLabel(code, lang, 1) ?? code}
                </Chip>
              ))}
            </div>
            {ing.unitCode === null && (
              <TextField
                label={t('editor.unit_free')}
                value={ing.unitRaw}
                maxLength={50}
                lang={lang}
                onChange={(e) => onChange({ unitRaw: e.target.value })}
              />
            )}
          </fieldset>
        )}
        <Chip selected={ing.optional} onToggle={() => onChange({ optional: !ing.optional })}>
          {t('editor.optional_toggle')}
        </Chip>
        <TextField
          label={t('review.note')}
          placeholder={t('editor.note_hint')}
          value={ing.note}
          maxLength={500}
          lang={lang}
          onChange={(e) => onChange({ note: e.target.value })}
        />
        {onSection && sections.length > 1 && (
          <fieldset className="plain">
            <legend className="label">{t('editor.section')}</legend>
            <div className="row row--wrap" lang={lang}>
              {sections.map((g) => (
                <Chip key={g} selected={ing.group === g} onToggle={() => onSection(g)}>
                  {g}
                </Chip>
              ))}
            </div>
          </fieldset>
        )}
        <div className="row row--wrap">
          <Button variant="secondary" onClick={() => onMove(-1)}>
            {t('editor.move_up')}
          </Button>
          <Button variant="secondary" onClick={() => onMove(1)}>
            {t('editor.move_down')}
          </Button>
          <Button variant="danger" onClick={onRemove}>
            {t('editor.remove_ingredient')}
          </Button>
        </div>
        <Button onClick={onClose}>{t('common.done')}</Button>
      </div>
    </BottomSheet>
  );
}

/* ---------------------------------------------------------------- one step */

export function shareLabel(share: number, all: string): string {
  if (Math.abs(share - 1) < 1e-6) return all;
  const glyph: Array<[number, string]> = [
    [3 / 4, '¾'],
    [2 / 3, '⅔'],
    [1 / 2, '½'],
    [1 / 3, '⅓'],
    [1 / 4, '¼'],
  ];
  const g = glyph.find(([f]) => Math.abs(f - share) < 1e-3);
  return g ? g[1] : `${Math.round(share * 100)} %`;
}

export function StepCard({
  step,
  n,
  count,
  ingredients,
  allSteps,
  labels,
  langs,
  errors,
  onChange,
  onMove,
  onRemove,
}: {
  step: EdStep;
  n: number;
  count: number;
  ingredients: EdIngredient[];
  allSteps: EdStep[];
  labels: Map<string, string>;
  langs: Langs;
  errors: Errors;
  onChange: (patch: Partial<EdStep>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const lang = langs.recipeLang;
  const area = useRef<HTMLTextAreaElement>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [showVideo, setShowVideo] = useState(step.video.trim() !== '');
  const byKey = new Map(ingredients.map((i) => [i.key, i]));
  const shown = displayText(step.text, labels);
  const named = ingredients.filter((i) => i.name.trim());
  const linked = step.links.filter((l) => byKey.has(l.key) && !l.suggested);
  const suggestedLinks = step.links.filter((l) => byKey.has(l.key) && l.suggested);
  const suggestedTimers = step.timers.filter((tm) => tm.suggested);
  const decideLink = (key: string, keep: boolean) =>
    onChange({
      links: keep
        ? step.links.map((l) => (l.key === key ? { ...l, suggested: false } : l))
        : step.links.filter((l) => l.key !== key),
    });
  const decideTimer = (key: string, keep: boolean) =>
    onChange({
      timers: keep
        ? step.timers.map((x) => (x.key === key ? { ...x, suggested: false } : x))
        : step.timers.filter((x) => x.key !== key),
    });
  const unlinked = named.filter((i) => !step.links.some((l) => l.key === i.key));
  const preview = step.text.includes('{ing:') ? previewText(step, ingredients, langs) : null;
  const link = linkFor ? step.links.find((l) => l.key === linkFor) : undefined;
  const linkIng = linkFor ? byKey.get(linkFor) : undefined;
  const remember = () => {
    const el = area.current;
    if (el) selection.current = { start: el.selectionStart, end: el.selectionEnd };
  };

  const setText = (display: string) => onChange({ text: canonicalText(display, labels) });

  /** Owner decision: inserts "name (amount)"; the word can then be changed freely. */
  function insert(ing: EdIngredient) {
    const piece = insertion(ing, labels);
    const sel = selection.current ?? { start: shown.length, end: shown.length };
    const before = shown.slice(0, sel.start);
    const after = shown.slice(sel.end);
    const pad = before && !/\s$/.test(before) ? ' ' : '';
    const next = `${before}${pad}${piece}${after}`;
    setText(next);
    const caret = before.length + pad.length + piece.length;
    selection.current = { start: caret, end: caret };
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(caret, caret);
    });
  }

  function linkIngredient(key: string) {
    onChange({ links: [...step.links, { key, share: defaultShare(allSteps, key, step.key) }] });
  }

  return (
    <div className="section stack stack--tight" data-testid="step-card">
      <div className="row row--between">
        <h3>{t('recipe.step_n', { n })}</h3>
        <div className="row">
          <Button
            variant="ghost"
            aria-label={t('editor.move_up')}
            disabled={n === 1}
            onClick={() => onMove(-1)}
          >
            {'↑'}
          </Button>
          <Button
            variant="ghost"
            aria-label={t('editor.move_down')}
            disabled={n === count}
            onClick={() => onMove(1)}
          >
            {'↓'}
          </Button>
          <Button variant="ghost" aria-label={t('editor.remove_step')} onClick={onRemove}>
            {'✕'}
          </Button>
        </div>
      </div>
      <textarea
        ref={area}
        className="field textarea"
        value={shown}
        lang={lang}
        maxLength={5000}
        aria-label={t('editor.step_text_n', { n })}
        aria-invalid={!!errors[`step:${step.key}:text`]}
        onChange={(e) => {
          setText(e.target.value);
          selection.current = { start: e.target.selectionStart, end: e.target.selectionEnd };
        }}
        onSelect={remember}
        onKeyUp={remember}
        onClick={remember}
      />
      {preview !== null && (
        <p className="hint pre-line" data-testid="step-preview">
          <span className="label">{t('editor.step_preview')}</span>{' '}
          <span lang={lang}>{preview}</span>
        </p>
      )}
      {errors[`step:${step.key}:text`] && (
        <p className="error-text" role="alert">
          {t('editor.err_step')}
        </p>
      )}

      <span className="label">{t('recipe.step_ingredients')}</span>
      {suggestedLinks.length > 0 && (
        <div
          className="notice stack stack--tight"
          role="group"
          aria-label={t('review.links_found')}
        >
          <span className="label">{t('review.links_found')}</span>
          {suggestedLinks.map((l) => {
            const name = byKey.get(l.key)!.name.trim() || '?';
            const text = `${name} · ${shareLabel(l.share, t('editor.share_all'))}`;
            return (
              <div key={l.key} className="row">
                <span className="grow" lang={lang}>
                  {text}
                </span>
                <Button
                  variant="secondary"
                  aria-label={t('review.link_keep', { name })}
                  onClick={() => decideLink(l.key, true)}
                >
                  {t('review.keep')}
                </Button>
                <Button
                  variant="ghost"
                  aria-label={t('review.link_remove', { name })}
                  onClick={() => decideLink(l.key, false)}
                >
                  {t('review.remove')}
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <div className="row row--wrap">
        {linked.map((l) => {
          const ing = byKey.get(l.key)!;
          const text = `${ing.name.trim() || '?'} · ${shareLabel(l.share, t('editor.share_all'))}`;
          return (
            <Chip key={l.key} selected lang={lang} onToggle={() => setLinkFor(l.key)}>
              {text}
            </Chip>
          );
        })}
        <Button variant="ghost" onClick={() => setPicking(true)}>
          {t('editor.link_ingredient')}
        </Button>
      </div>
      {errors[`step:${step.key}:shares`] && (
        <p className="error-text" role="alert">
          {t('editor.err_shares')}
        </p>
      )}

      <PhotoSlot
        small
        photo={step.photo}
        label={t('recipe.step_photo', { n })}
        alt={t('recipe.step_photo', { n })}
        onChange={(photo) => onChange({ photo })}
      />

      {suggestedTimers.map((tm) => (
        <div
          key={tm.key}
          className="notice stack stack--tight"
          role="group"
          aria-label={t('review.timer_found', { time: tm.minutes })}
        >
          <span>
            {'⏱ '}
            {t('review.timer_found', { time: tm.minutes })}
            <span className="hint" lang={lang}>
              {' · '}
              {tm.label}
            </span>
          </span>
          <div className="row">
            <Button onClick={() => decideTimer(tm.key, true)}>{t('review.timer_add')}</Button>
            <Button variant="ghost" onClick={() => decideTimer(tm.key, false)}>
              {t('review.timer_skip')}
            </Button>
          </div>
        </div>
      ))}

      {step.timers
        .filter((tm) => !tm.suggested)
        .map((tm) => (
          <div key={tm.key} className="stack stack--tight">
            <div className="row">
              <div className="grow">
                <TextField
                  label={t('editor.timer_label')}
                  value={tm.label}
                  maxLength={100}
                  lang={lang}
                  onChange={(e) =>
                    onChange({
                      timers: step.timers.map((x) =>
                        x.key === tm.key ? { ...x, label: e.target.value } : x,
                      ),
                    })
                  }
                />
              </div>
              <div className="field-narrow">
                <TextField
                  label={t('editor.timer_minutes')}
                  value={tm.minutes}
                  inputMode="decimal"
                  maxLength={8}
                  aria-invalid={!!errors[`step:${step.key}:timer:${tm.key}`]}
                  onChange={(e) =>
                    onChange({
                      timers: step.timers.map((x) =>
                        x.key === tm.key ? { ...x, minutes: e.target.value } : x,
                      ),
                    })
                  }
                />
              </div>
              <Button
                variant="ghost"
                aria-label={t('editor.remove_timer')}
                onClick={() => onChange({ timers: step.timers.filter((x) => x.key !== tm.key) })}
              >
                {'✕'}
              </Button>
            </div>
            {errors[`step:${step.key}:timer:${tm.key}`] && (
              <p className="error-text" role="alert">
                {t('editor.err_timer')}
              </p>
            )}
          </div>
        ))}

      {showVideo && (
        <div className="stack stack--tight">
          <div className="row">
            <div className="grow">
              <TextField
                label={t('editor.video_link')}
                value={step.video}
                inputMode="url"
                maxLength={300}
                aria-invalid={!!errors[`step:${step.key}:video`]}
                onChange={(e) => onChange({ video: e.target.value })}
              />
            </div>
            <div className="field-narrow">
              <TextField
                label={t('editor.video_start')}
                value={step.videoStart}
                placeholder={'0:30'}
                maxLength={8}
                aria-invalid={!!errors[`step:${step.key}:video_start`]}
                onChange={(e) => onChange({ videoStart: e.target.value })}
              />
            </div>
            <Button
              variant="ghost"
              aria-label={t('editor.remove_video')}
              onClick={() => {
                onChange({ video: '', videoStart: '' });
                setShowVideo(false);
              }}
            >
              {'✕'}
            </Button>
          </div>
          {errors[`step:${step.key}:video`] && (
            <p className="error-text" role="alert">
              {t('editor.err_video')}
            </p>
          )}
          {errors[`step:${step.key}:video_start`] && (
            <p className="error-text" role="alert">
              {t('editor.err_video_start')}
            </p>
          )}
        </div>
      )}

      <div className="row row--wrap">
        {step.timers.length < 10 && (
          <Button
            variant="ghost"
            onClick={() =>
              onChange({
                timers: [...step.timers, suggestTimer(step, ingredients, langs)],
              })
            }
          >
            {t('editor.add_timer')}
          </Button>
        )}
        {!showVideo && (
          <Button variant="ghost" onClick={() => setShowVideo(true)}>
            {t('editor.add_video')}
          </Button>
        )}
      </div>

      <BottomSheet
        open={picking}
        title={t('editor.link_ingredient')}
        onClose={() => setPicking(false)}
      >
        <div className="stack">
          {unlinked.length === 0 ? (
            <p className="hint">{t('editor.nothing_to_link')}</p>
          ) : (
            <div className="row row--wrap" lang={lang}>
              {unlinked.map((i) => (
                <Chip key={i.key} onToggle={() => linkIngredient(i.key)}>
                  {i.name}
                </Chip>
              ))}
            </div>
          )}
          <Button onClick={() => setPicking(false)}>{t('common.done')}</Button>
        </div>
      </BottomSheet>

      <BottomSheet
        open={!!link && !!linkIng}
        title={linkIng?.name ?? ''}
        onClose={() => setLinkFor(null)}
      >
        {link && linkIng && (
          <div className="stack">
            <fieldset className="plain">
              <legend className="label">{t('editor.share')}</legend>
              <div className="row row--wrap">
                {[...new Set([...SHARE_CHOICES, link.share])].map((s) => (
                  <Chip
                    key={s}
                    selected={Math.abs(link.share - s) < 1e-6}
                    onToggle={() =>
                      onChange({
                        links: step.links.map((x) => (x.key === link.key ? { ...x, share: s } : x)),
                      })
                    }
                  >
                    {shareLabel(s, t('editor.share_all'))}
                  </Chip>
                ))}
              </div>
              <p className="hint">
                {t('editor.share_amount', { amount: amountPreview(linkIng, link.share, langs) })}
              </p>
              {usedShare(allSteps, link.key, step.key) > 0 && (
                <p className="hint">
                  {t('editor.share_elsewhere', {
                    part: shareLabel(
                      usedShare(allSteps, link.key, step.key),
                      t('editor.share_all'),
                    ),
                  })}
                </p>
              )}
            </fieldset>
            <Button
              variant="secondary"
              onClick={() => {
                insert(linkIng);
                setLinkFor(null);
              }}
            >
              {t('editor.insert_amount')}
            </Button>
            <p className="hint">{t('editor.insert_hint')}</p>
            <Button
              variant="ghost"
              onClick={() => {
                onChange({ links: step.links.filter((x) => x.key !== link.key) });
                setLinkFor(null);
              }}
            >
              {t('editor.unlink')}
            </Button>
            <Button onClick={() => setLinkFor(null)}>{t('common.done')}</Button>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

const previewOrText = (step: EdStep, ings: EdIngredient[], langs: Langs) =>
  step.text.includes('{ing:') ? previewText(step, ings, langs) : step.text;

/**
 * A new timer: the first time the step text mentions that has no timer yet ("Выпекайте 40 минут"),
 * found by the same rules as the text import (PRD 5.1.4); otherwise named after the first sentence.
 */
export function suggestTimer(step: EdStep, ings: EdIngredient[], langs: Langs): EdTimer {
  const text = previewOrText(step, ings, langs);
  const taken = new Set(step.timers.map((t) => t.minutes.trim()));
  const found = findDurations(text).find(
    (d) => !taken.has(numberInput(d.durationSec / 60, langs.recipeLang)),
  );
  return found
    ? {
        key: newKey('t'),
        label: found.label.slice(0, 100) || defaultTimerLabel(text),
        minutes: numberInput(found.durationSec / 60, langs.recipeLang),
      }
    : { key: newKey('t'), label: defaultTimerLabel(text), minutes: '' };
}

/** A new timer is named after the first sentence of its step ("Выпекайте 40 минут при 180 °C"). */
export function defaultTimerLabel(text: string): string {
  const first = text.trim().split(/(?<=[.!?…])\s/)[0] ?? '';
  let end = first.length;
  while (end > 0 && '.!?…'.includes(first[end - 1]!)) end--;
  const label = first.slice(0, end).trim();
  return label.length > 100 ? `${label.slice(0, 99)}…` : label;
}
