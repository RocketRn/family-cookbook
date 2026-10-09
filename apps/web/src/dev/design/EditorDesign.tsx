import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SYSTEM_TAGS } from '../../screens/BookScreen';
import { Button } from '../../design/Button';
import { Chip } from '../../design/Chip';
import { TextField } from '../../design/Fields';
import { BottomSheet } from '../../design/BottomSheet';
import { isLanguage, LANGUAGES, LANGUAGE_NAMES } from '../../i18n';
import { unitLabel } from '@cookbook/recipe-core';
import { LINES, STEPS } from './sample';

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const VISIBILITIES = ['private', 'book', 'link'] as const;
const QTY_KINDS = ['exact', 'range', 'to_taste', 'pinch'] as const;
const UNIT_CHOICES = ['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'pcs', 'clove', 'pack'];

/** UX-03: recipe editor (PRD 6.2 FE-04; built in Sprint 3). Local state only, nothing is saved. */
export function EditorDesign() {
  const { t, i18n } = useTranslation();
  const [servings, setServings] = useState(6);
  const [difficulty, setDifficulty] = useState<string>('easy');
  const [visibility, setVisibility] = useState<string>('book');
  const [language, setLanguage] = useState('ru');
  const [tags, setTags] = useState(new Set(['baking', 'dessert']));
  const [kind, setKind] = useState<string>('exact');
  const [unit, setUnit] = useState<string | null>('pcs');
  const [optional, setOptional] = useState(false);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  // A publish attempt with a missing part shows what is missing (API 409 NOT_PUBLISHABLE).
  const [triedPublish, setTriedPublish] = useState(false);
  const missing = new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format([
    t('editor.missing_step'),
  ]);
  const ingredients = LINES.filter((l) => l.kind !== 'unparsed');

  return (
    <div className="stack">
      <h1>{t('editor.title_new')}</h1>

      <button type="button" className="slot">
        <span aria-hidden="true">{'＋'}</span>
        <span>{t('editor.add_photo')}</span>
        <span className="hint">{t('editor.photo_hint')}</span>
      </button>

      <section className="section stack stack--tight" aria-labelledby="ed-basics">
        <h2 id="ed-basics">{t('editor.basics')}</h2>
        <TextField label={t('editor.field_title')} defaultValue="Шарлотка" lang="ru" />
        <div className="row row--between">
          <div>
            <div>{t('editor.servings')}</div>
            <div className="hint">{t('editor.servings_hint')}</div>
          </div>
          <div className="row stepper">
            <Button
              variant="secondary"
              aria-label={t('editor.fewer')}
              onClick={() => setServings((n) => Math.max(1, n - 1))}
            >
              {'−'}
            </Button>
            <output aria-live="polite">{servings}</output>
            <Button
              variant="secondary"
              aria-label={t('editor.more')}
              onClick={() => setServings((n) => n + 1)}
            >
              {'+'}
            </Button>
          </div>
        </div>
        <fieldset className="plain">
          <legend className="label">{t('filters.difficulty')}</legend>
          <div className="row row--wrap">
            {DIFFICULTIES.map((d) => (
              <Chip key={d} selected={difficulty === d} onToggle={() => setDifficulty(d)}>
                {t(`difficulty.${d}`)}
              </Chip>
            ))}
          </div>
        </fieldset>
        <div className="row">
          <div className="grow">
            <TextField label={t('editor.prep_min')} defaultValue="15" inputMode="numeric" />
          </div>
          <div className="grow">
            <TextField label={t('editor.cook_min')} defaultValue="40" inputMode="numeric" />
          </div>
        </div>
        <fieldset className="plain">
          <legend className="label">{t('editor.language')}</legend>
          <div className="row row--wrap">
            {LANGUAGES.map((l) => (
              <Chip key={l} selected={language === l} onToggle={() => setLanguage(l)} lang={l}>
                {LANGUAGE_NAMES[l]}
              </Chip>
            ))}
          </div>
          <p className="hint">{t('editor.language_hint')}</p>
        </fieldset>
      </section>

      <section className="section stack stack--tight" aria-labelledby="ed-ings">
        <h2 id="ed-ings">{t('recipe.ingredients')}</h2>
        <input
          className="field field--sm field--section"
          defaultValue="Для теста"
          aria-label={t('editor.section_name')}
          lang="ru"
        />
        <ul className="edit-lines" lang="ru">
          {ingredients.slice(0, 3).map((l) => (
            <li key={l.id} className="edit-line">
              <div className="row">
                <span className="handle" role="img" aria-label={t('editor.move')}>
                  {'⋮⋮'}
                </span>
                <input
                  className="field field--sm grow"
                  defaultValue={l.name}
                  aria-label={t('editor.ingredient_name')}
                />
                <input
                  className="field field--sm field--amount"
                  defaultValue={l.amount}
                  aria-label={t('editor.amount')}
                />
                <button
                  type="button"
                  className="chip chip--unit"
                  aria-label={t('editor.ingredient_details')}
                  onClick={() => setSheetFor(l.id)}
                >
                  {l.unit || t('editor.no_unit')}
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="row row--wrap">
          <Button variant="ghost">{t('editor.add_ingredient')}</Button>
          <Button variant="ghost">{t('editor.add_section')}</Button>
        </div>
      </section>

      <section className="stack stack--tight" aria-labelledby="ed-steps">
        <h2 id="ed-steps">{t('recipe.steps')}</h2>
        {STEPS.slice(0, 2).map((s, i) => (
          <div key={s.id} className="section stack stack--tight">
            <h3>{t('recipe.step_n', { n: i + 1 })}</h3>
            <textarea
              className="field textarea"
              defaultValue={s.text}
              lang="ru"
              aria-label={t('editor.step_text')}
            />
            <span className="label">{t('recipe.step_ingredients')}</span>
            <div className="row row--wrap">
              {ingredients
                .filter((l) => s.links.includes(l.id))
                .map((l) => (
                  <Chip key={l.id} selected lang="ru">
                    {l.name}
                  </Chip>
                ))}
              <Button variant="ghost">{t('editor.link_ingredient')}</Button>
            </div>
            <div className="row row--wrap">
              <button type="button" className="slot slot--small">
                <span aria-hidden="true">{'＋'}</span>
                <span>{t('editor.add_photo')}</span>
              </button>
              <Button variant="ghost">{t('editor.add_timer')}</Button>
            </div>
            {s.video && (
              <div className="row">
                <div className="grow">
                  <TextField
                    label={t('editor.video_link')}
                    defaultValue={`https://youtu.be/${s.video.id}`}
                    inputMode="url"
                  />
                </div>
                <div style={{ width: 96 }}>
                  <TextField label={t('editor.video_start')} defaultValue="0:30" />
                </div>
              </div>
            )}
          </div>
        ))}
        <Button variant="ghost">{t('editor.add_step')}</Button>
      </section>

      <section className="section stack stack--tight" aria-labelledby="ed-tags">
        <h2 id="ed-tags">{t('filters.tags')}</h2>
        <div className="row row--wrap">
          {SYSTEM_TAGS.map((tag) => (
            <Chip
              key={tag}
              selected={tags.has(tag)}
              onToggle={() =>
                setTags((s) => {
                  const n = new Set(s);
                  if (n.has(tag)) n.delete(tag);
                  else n.add(tag);
                  return n;
                })
              }
            >
              {t(`tags.${tag}`)}
            </Chip>
          ))}
        </div>
        <TextField label={t('editor.custom_tag')} placeholder={t('editor.custom_tag_hint')} />
      </section>

      <section className="section stack stack--tight" aria-labelledby="ed-vis">
        <h2 id="ed-vis">{t('editor.visibility')}</h2>
        <div className="stack stack--tight" role="radiogroup" aria-labelledby="ed-vis">
          {VISIBILITIES.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={visibility === v}
              className="option"
              onClick={() => setVisibility(v)}
            >
              <strong>{t(`recipe.visibility.${v}`)}</strong>
              <span className="hint">{t(`editor.visibility_${v}_hint`)}</span>
            </button>
          ))}
        </div>
      </section>

      <BottomSheet
        open={sheetFor !== null}
        title={t('editor.ingredient_details')}
        onClose={() => setSheetFor(null)}
      >
        <div className="stack">
          <fieldset className="plain">
            <legend className="label">{t('editor.qty_kind')}</legend>
            <div className="row row--wrap">
              {QTY_KINDS.map((k) => (
                <Chip key={k} selected={kind === k} onToggle={() => setKind(k)}>
                  {t(`editor.qty_${k}`)}
                </Chip>
              ))}
            </div>
          </fieldset>
          <fieldset className="plain">
            <legend className="label">{t('editor.unit')}</legend>
            {/* Unit names come from recipe-core UNITS, in the recipe's language (D-021). */}
            <div className="row row--wrap" lang={language}>
              <Chip selected={unit === null} onToggle={() => setUnit(null)}>
                {t('editor.no_unit')}
              </Chip>
              {UNIT_CHOICES.map((code) => (
                <Chip key={code} selected={unit === code} onToggle={() => setUnit(code)}>
                  {unitLabel(code, isLanguage(language) ? language : 'ru', 1)}
                </Chip>
              ))}
            </div>
          </fieldset>
          <Chip selected={optional} onToggle={() => setOptional((o) => !o)}>
            {t('editor.optional_toggle')}
          </Chip>
          <TextField label={t('review.note')} placeholder={t('editor.note_hint')} />
          <Button onClick={() => setSheetFor(null)}>{t('common.done')}</Button>
        </div>
      </BottomSheet>

      {triedPublish && (
        <p className="error-text" role="alert">
          {t('editor.publish_missing', { items: missing })}
        </p>
      )}
      <div className="actionbar row">
        <Button variant="secondary" className="grow">
          {t('editor.save_draft')}
        </Button>
        <Button className="grow" onClick={() => setTriedPublish(true)}>
          {t('editor.publish')}
        </Button>
      </div>
    </div>
  );
}
