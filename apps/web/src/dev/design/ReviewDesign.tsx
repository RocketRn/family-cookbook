import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../design/Button';
import { Chip } from '../../design/Chip';
import { TextField } from '../../design/Fields';
import { LINES, LOW_CONFIDENCE, ORIGINAL_TEXT, STEPS, type SampleLine } from './sample';

/** Groups lines by their parsed section, keeping the order of the text. */
function sections(lines: SampleLine[]) {
  const out: Array<{ label: string | null; lines: SampleLine[] }> = [];
  for (const l of lines) {
    const last = out[out.length - 1];
    if (last && last.label === l.section) last.lines.push(l);
    else out.push({ label: l.section, lines: [l] });
  }
  return out;
}

function Line({ line }: { line: SampleLine }) {
  const { t } = useTranslation();
  const low = line.confidence < LOW_CONFIDENCE;
  return (
    <li className={low ? 'edit-line edit-line--low' : 'edit-line'} data-low={low || undefined}>
      <div className="row">
        <span className="handle" role="img" aria-label={t('editor.move')}>
          {'⋮⋮'}
        </span>
        <input
          className="field field--sm grow"
          defaultValue={line.name}
          aria-label={t('editor.ingredient_name')}
        />
        {line.kind === 'to_taste' || line.kind === 'pinch' ? (
          <button
            type="button"
            className="chip chip--unit chip--qty"
            aria-label={t('editor.qty_kind')}
          >
            {t(`editor.qty_${line.kind}`)}
          </button>
        ) : (
          <>
            <input
              className="field field--sm field--amount"
              defaultValue={line.amount}
              aria-label={t('editor.amount')}
            />
            <button type="button" className="chip chip--unit" aria-label={t('editor.unit')}>
              {line.unit || t('editor.no_unit')}
            </button>
          </>
        )}
      </div>
      {line.note && (
        <p className="hint">
          {t('review.note')}
          {': '}
          {line.note}
        </p>
      )}
      {low && (
        <ul className="edit-line__reasons" aria-label={t('review.why_check')}>
          {line.reasons.map((r) => (
            <li key={r}>{t(`review.reason_${r}`)}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** UX-03: import review (PRD 2.2 steps 6-9; FE-05 builds it in Sprint 4). */
export function ReviewDesign() {
  const { t } = useTranslation();
  const [timer, setTimer] = useState<'pending' | 'added' | 'skipped'>('pending');
  const [links, setLinks] = useState(() => new Map(STEPS.map((s) => [s.id, new Set(s.links)])));
  const toCheck = LINES.filter((l) => l.confidence < LOW_CONFIDENCE).length;
  const nameOf = new Map(LINES.map((l) => [l.id, l.name]));
  const toggle = (step: string, ing: string) =>
    setLinks((m) => {
      const next = new Map(m);
      const set = new Set(next.get(step));
      if (set.has(ing)) set.delete(ing);
      else set.add(ing);
      next.set(step, set);
      return next;
    });

  return (
    <div className="stack">
      <div className="stack stack--tight">
        <h1>{t('review.title')}</h1>
        <p className="hint">{t('review.intro')}</p>
      </div>
      <details className="section">
        <summary>{t('review.original')}</summary>
        <pre className="original-text" lang="ru">
          {ORIGINAL_TEXT}
        </pre>
      </details>
      {toCheck > 0 && (
        <p className="notice" role="status">
          {t('review.to_check', { count: toCheck })}
        </p>
      )}

      <section className="section stack stack--tight" aria-labelledby="rv-basics">
        <h2 id="rv-basics">{t('editor.basics')}</h2>
        <TextField label={t('editor.field_title')} defaultValue="Шарлотка" lang="ru" />
        <TextField label={t('editor.servings')} defaultValue="6" inputMode="decimal" />
      </section>

      <section className="section stack stack--tight" aria-labelledby="rv-ings">
        <h2 id="rv-ings">{t('recipe.ingredients')}</h2>
        {sections(LINES).map((g) => (
          <div key={g.label ?? '-'} className="stack stack--tight">
            <input
              className="field field--sm field--section"
              defaultValue={g.label ?? ''}
              placeholder={t('editor.section_name')}
              aria-label={t('editor.section_name')}
            />
            <ul className="edit-lines" lang="ru">
              {g.lines.map((l) => (
                <Line key={l.id} line={l} />
              ))}
            </ul>
          </div>
        ))}
        <div className="row row--wrap">
          <Button variant="ghost">{t('editor.add_ingredient')}</Button>
          <Button variant="ghost">{t('editor.add_section')}</Button>
        </div>
      </section>

      <section className="stack stack--tight" aria-labelledby="rv-steps">
        <h2 id="rv-steps">{t('recipe.steps')}</h2>
        {STEPS.map((s, i) => (
          <div key={s.id} className="section stack stack--tight">
            <h3>{t('recipe.step_n', { n: i + 1 })}</h3>
            <textarea
              className="field textarea"
              defaultValue={s.text}
              lang="ru"
              aria-label={t('editor.step_text')}
            />
            <div className="stack stack--tight">
              <span className="label">{t('review.links_suggested')}</span>
              <div className="row row--wrap" role="group" aria-label={t('review.links_suggested')}>
                {LINES.filter((l) => l.kind !== 'unparsed').map((l) => (
                  <Chip
                    key={l.id}
                    selected={links.get(s.id)?.has(l.id)}
                    onToggle={() => toggle(s.id, l.id)}
                    lang="ru"
                  >
                    {nameOf.get(l.id)}
                  </Chip>
                ))}
              </div>
            </div>
            {s.timer && (
              <div
                className="notice stack stack--tight"
                role="group"
                aria-label={t('review.timer_found', { time: s.timer.sec / 60 })}
              >
                <span>
                  {'⏱ '}
                  {t('review.timer_found', { time: s.timer.sec / 60 })}
                  <span className="hint" lang="ru">
                    {' · '}
                    {s.timer.label}
                  </span>
                </span>
                {timer === 'pending' ? (
                  <div className="row">
                    <Button onClick={() => setTimer('added')}>{t('review.timer_add')}</Button>
                    <Button variant="ghost" onClick={() => setTimer('skipped')}>
                      {t('review.timer_skip')}
                    </Button>
                  </div>
                ) : (
                  <span className="hint">
                    {timer === 'added' ? t('review.timer_added') : t('review.timer_skipped')}
                  </span>
                )}
              </div>
            )}
            {s.video && (
              <p className="hint">
                {t('review.video_found', { time: `0:${String(s.video.start).padStart(2, '0')}` })}
              </p>
            )}
          </div>
        ))}
      </section>

      <div className="actionbar row">
        <Button variant="secondary" className="grow">
          {t('editor.save_draft')}
        </Button>
        <Button className="grow">{t('review.continue')}</Button>
      </div>
    </div>
  );
}
