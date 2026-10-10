import { useRef, useState } from 'react';
import type { Recipe } from '../api/types';
import { newCookState, type CookState } from '../cook/state';
import { TimersPanel } from '../cook/TimerParts';
import { useCookTimers, type CookTimers } from '../cook/useCookTimers';

/**
 * FE-09, full version (D-050): a step's timer can be started from the recipe card, without
 * cooking mode. The same timers as in cooking mode (server timers, the bot's message, the
 * question about messages, the alarm), kept for this card only: a timer started here without a
 * connection syncs while the card is open, and is forgotten when it closes (cooking mode keeps it).
 */
export function useCardTimers(r: Recipe, botStarted: boolean): CookTimers {
  const stRef = useRef<CookState>(newCookState(r, null));
  const [, redraw] = useState(0);
  const save = (next: CookState) => {
    stRef.current = next;
    redraw((n) => n + 1);
  };
  return useCookTimers({ active: true, stRef, save, botStarted });
}

/** Running timers on the card: shown only while there are any, kept in view at the bottom. */
export function CardTimersPanel({ timers }: { timers: CookTimers }) {
  if (timers.chips.length === 0) return null;
  return (
    <div className="card-timers">
      <TimersPanel timers={timers} />
    </div>
  );
}
