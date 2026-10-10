import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Step } from '../api/types';
import { BottomSheet } from '../design/BottomSheet';
import { Button } from '../design/Button';
import { Chip } from '../design/Chip';
import { BOT_USERNAME } from '../telegram/bot';
import { getRuntime } from '../telegram/sdk';
import { formatClock } from './timers';
import type { CookTimers } from './useCookTimers';

/** The step's timers as big buttons (PRD 2.4 step 7). A running one cannot be started twice. */
export function TimerButtons({
  step,
  timers,
  lang,
  recalculated,
}: {
  step: Step;
  timers: CookTimers;
  lang: string | undefined;
  recalculated: boolean;
}) {
  const { t } = useTranslation();
  if (step.timers.length === 0) return null;
  return (
    <div className="stack stack--tight">
      {step.timers.map((tm) => (
        <Button
          key={tm.id}
          block
          className="cook__timer-btn"
          disabled={timers.isRunning(step.id, tm.label)}
          onClick={() => timers.start(step, tm)}
        >
          <span lang={lang}>
            {t('cook.timer_start', { label: tm.label, time: formatClock(tm.duration_sec) })}
          </span>
        </Button>
      ))}
      {/* PRD 2.3: timers are not scaled with the amounts. */}
      {recalculated && <p className="hint">{t('recalc.time_note')}</p>}
    </div>
  );
}

/** PRD 2.4 step 9: every running timer as a chip, on every step; +1 min and cancel. */
export function TimersPanel({ timers }: { timers: CookTimers }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const { chips, serverNow } = timers;
  const selected = chips.find((c) => c.key === open);
  const selectedRunning = selected && !selected.ended && selected.endsAt > serverNow;
  return (
    <section className="cook__timers stack stack--tight" aria-label={t('cook.timers')}>
      {timers.offline && (
        <p className="notice" role="status">
          {t('cook.offline')}
        </p>
      )}
      {chips.length > 0 && (
        <div className="row row--wrap">
          {chips.map((c) => {
            const over = c.ended || c.endsAt <= serverNow;
            return (
              <Chip
                key={c.key}
                selected={open === c.key}
                onToggle={() => setOpen(open === c.key ? null : c.key)}
              >
                {c.failed
                  ? t('cook.timer_failed', { label: c.label })
                  : over
                    ? t('cook.timer_done', { label: c.label })
                    : t('cook.timer_running', {
                        label: c.label,
                        left: formatClock((c.endsAt - serverNow) / 1000),
                      })}
              </Chip>
            );
          })}
        </div>
      )}
      {selected && selectedRunning && (
        <div className="row">
          {!selected.local && (
            <Button variant="secondary" onClick={() => timers.extend(selected)}>
              {t('cook.timer_add')}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(null);
              timers.cancel(selected);
            }}
          >
            {t('cook.timer_cancel')}
          </Button>
        </div>
      )}
      {timers.botCanWrite && !chips.some((c) => c.failed) ? (
        <p className="hint">{t('cook.timer_bot')}</p>
      ) : (
        <div className="stack stack--tight">
          <p className="hint">
            {chips.some((c) => c.failed) ? t('cook.timer_failed_hint') : t('cook.timer_no_message')}
          </p>
          <div>
            <Button
              variant="secondary"
              onClick={() => getRuntime().webApp.openTelegramLink(`https://t.me/${BOT_USERNAME}`)}
            >
              {t('cook.bot_open')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** PRD 4.6 #4: a timer reached zero while the app is open. */
export function TimerAlarm({ timers }: { timers: CookTimers }) {
  const { t } = useTranslation();
  if (timers.ringing.length === 0) return null;
  return (
    <div className="notice cook__alarm stack stack--tight" role="alert">
      {timers.ringing.map((label, i) => (
        <p key={i}>{t('cook.timer_done', { label })}</p>
      ))}
      <div>
        <Button onClick={timers.stopRinging}>{t('common.close')}</Button>
      </div>
    </div>
  );
}

/** PRD 4.5: before the first timer, why the bot needs to write, then Telegram's own question. */
export function WriteAccessSheet({ timers }: { timers: CookTimers }) {
  const { t } = useTranslation();
  return (
    <BottomSheet
      open={timers.asking}
      title={t('cook.write_title')}
      onClose={() => timers.answerAsk(false)}
    >
      <div className="stack">
        <p>{t('cook.write_text')}</p>
        <Button block onClick={() => timers.answerAsk(true)}>
          {t('cook.write_allow')}
        </Button>
        <Button block variant="secondary" onClick={() => timers.answerAsk(false)}>
          {t('cook.write_later')}
        </Button>
      </div>
    </BottomSheet>
  );
}
