import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../design/Button';
import { Chip } from '../../design/Chip';
import { TextField } from '../../design/Fields';
import { LINES, STEPS } from './sample';

const SCREENS = ['prep', 'step', 'timers', 'done', 'problems'] as const;
type Screen = (typeof SCREENS)[number];
const TITLE = 'Шарлотка';
const amountOf = (l: (typeof LINES)[number]) =>
  l.kind === 'to_taste' ? 'по вкусу' : [l.amount, l.unit].filter(Boolean).join(' ');

/**
 * UX-04 (PRD 2.4, 6.2): cooking-mode designs for FE-08 / BE-08 (Sprints 4-5). Sample data, nothing
 * is saved, no timer runs. Large step text, big tap targets, Back / Next buttons as well as swipes
 * (Telegram Desktop has no gestures), and the error states of PRD 2.4.
 */
export function CookDesign() {
  const { t } = useTranslation();
  const [screen, setScreen] = useState<Screen>('prep');
  return (
    <div className="stack">
      <div className="row row--wrap" role="group" aria-label={t('dev.cook_link')}>
        {SCREENS.map((s) => (
          <Chip key={s} selected={screen === s} onToggle={() => setScreen(s)}>
            {t(`cook.screen_${s}`)}
          </Chip>
        ))}
      </div>
      {screen === 'prep' && <Preparation />}
      {screen === 'step' && <StepScreen timers={false} />}
      {screen === 'timers' && <StepScreen timers />}
      {screen === 'done' && <Done />}
      {screen === 'problems' && <Problems />}
    </div>
  );
}

/** PRD 2.4 steps 2-3: resume or start over, then "do I have everything?". */
function Preparation() {
  const { t } = useTranslation();
  const [checked, setChecked] = useState(new Set<string>());
  return (
    <div className="stack">
      <h1>{t('cook.title', { title: TITLE })}</h1>
      <section className="notice stack stack--tight" aria-label={t('cook.resume_label')}>
        <p>{t('cook.resume', { n: 2, total: STEPS.length })}</p>
        <div className="row">
          <Button className="grow">{t('cook.resume_continue')}</Button>
          <Button className="grow" variant="secondary">
            {t('cook.resume_restart')}
          </Button>
        </div>
      </section>
      <section className="section stack stack--tight" aria-labelledby="ck-prep">
        <h2 id="ck-prep">{t('cook.prep_title')}</h2>
        <p className="hint">{t('cook.prep_hint')}</p>
        <ul className="ings" lang="ru">
          {LINES.map((l) => (
            <li key={l.id} className="ing">
              <label className="row grow cook__check">
                <input
                  type="checkbox"
                  checked={checked.has(l.id)}
                  onChange={() =>
                    setChecked((s) => {
                      const n = new Set(s);
                      if (n.has(l.id)) n.delete(l.id);
                      else n.add(l.id);
                      return n;
                    })
                  }
                />
                <span className="grow">{l.name}</span>
                <span className="ing__amount">{amountOf(l)}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>
      <div className="actionbar">
        <Button block>{t('cook.start')}</Button>
      </div>
    </div>
  );
}

/** PRD 2.4 steps 5-11: one step per screen; timers as chips at the bottom on every step. */
function StepScreen({ timers }: { timers: boolean }) {
  const { t } = useTranslation();
  const n = timers ? 3 : 2;
  const step = STEPS[n - 1]!;
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="stack cook">
      <div className="row row--between">
        <span className="label">{t('cook.step_of', { n, total: STEPS.length })}</span>
        <Button variant="ghost">{t('cook.exit')}</Button>
      </div>
      <div className="cook__progress" aria-hidden="true">
        <span style={{ width: `${(n / STEPS.length) * 100}%` }} />
      </div>
      {/* The whole step area is the swipe zone; vertical swipes stay off (disableVerticalSwipes). */}
      <div className="cook__swipe stack" data-swipe-zone>
        <p className="cook__text" lang="ru">
          {step.text}
        </p>
        <ul className="ings" lang="ru" aria-label={t('recipe.step_ingredients')}>
          {LINES.filter((l) => step.links.includes(l.id)).map((l) => (
            <li key={l.id} className="ing">
              <span className="grow">{l.name}</span>
              <span className="ing__amount">{amountOf(l)}</span>
            </li>
          ))}
        </ul>
        {step.video && <Button variant="secondary">{t('cook.video_at_step')}</Button>}
        {step.timer && (
          <Button block className="cook__timer-btn">
            {t('cook.timer_start', { label: step.timer.label, time: '40:00' })}
          </Button>
        )}
        <p className="hint">{t('cook.swipe_hint')}</p>
      </div>
      {timers && (
        <section className="cook__timers stack stack--tight" aria-label={t('cook.timers')}>
          <div className="row row--wrap">
            <Chip selected onToggle={() => setOpen('bake')}>
              {t('cook.timer_running', { label: 'Выпекайте', left: '38:12' })}
            </Chip>
            <Chip selected onToggle={() => setOpen('whisk')}>
              {t('cook.timer_done', { label: 'Взбивайте' })}
            </Chip>
          </div>
          {open && (
            <div className="row">
              <Button variant="secondary">{t('cook.timer_add')}</Button>
              <Button variant="ghost">{t('cook.timer_cancel')}</Button>
            </div>
          )}
          <p className="hint">{t('cook.timer_bot')}</p>
        </section>
      )}
      <div className="actionbar row">
        <Button variant="secondary" className="grow cook__nav">
          {t('cook.prev')}
        </Button>
        <Button className="grow cook__nav">
          {n === STEPS.length ? t('cook.finish') : t('cook.next')}
        </Button>
      </div>
    </div>
  );
}

/** PRD 2.4 steps 12-13. */
function Done() {
  const { t } = useTranslation();
  const [cooked, setCooked] = useState(false);
  const myVersion = `${t('cook.my_version')} · ${t('common.coming_soon')}`;
  return (
    <div className="stack center">
      <p className="cook__done" aria-hidden="true">
        {'🎉'}
      </p>
      <h1>{t('cook.done_title')}</h1>
      <p>{t('cook.done_text')}</p>
      <Button block onClick={() => setCooked(true)}>
        {t('cook.cooked')}
      </Button>
      {cooked && (
        <div className="section stack stack--tight">
          <button type="button" className="slot slot--small">
            <span aria-hidden="true">{'＋'}</span>
            <span>{t('cook.cooked_photo')}</span>
          </button>
          <TextField label={t('cook.cooked_comment')} />
          <Button>{t('cook.cooked_send')}</Button>
        </div>
      )}
      <Button block variant="secondary">
        {t('cook.again')}
      </Button>
      <Button block variant="ghost" disabled>
        {myVersion}
      </Button>
    </div>
  );
}

/** PRD 2.4 "Exceptions and edge cases", as the user would see them. */
function Problems() {
  const { t } = useTranslation();
  return (
    <div className="stack">
      <p className="notice" role="status">
        {t('cook.offline')}
      </p>
      <div className="notice stack stack--tight">
        <p>{t('cook.bot_needed')}</p>
        <div>
          <Button variant="secondary">{t('cook.bot_open')}</Button>
        </div>
      </div>
      <p className="notice">{t('cook.recipe_updated')}</p>
      <div className="toast toast--static" role="status">
        {t('cook.wake_lock')}
      </div>
    </div>
  );
}
