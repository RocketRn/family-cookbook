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
export function useCardTimers(r: Recipe, botStarted: boolean, guest?: string): CookTimers {
  // A guest's timers carry the link's token (S6-3, D-055).
  const stRef = useRef<CookState>(newCookState(r, null, guest));
  const [, redraw] = useState(0);
  const save = (next: CookState) => {
    stRef.current = next;
    redraw((n) => n + 1);
  };
  const timers = useCookTimers({ active: true, stRef, save, botStarted });
  // The panel shows the person's running timers, the ones whose message was not delivered, and
  // the ones that ended while this card was open. A timer that had ended before (the server
  // lists it for 15 minutes) already rang: kept at the bottom of every card it only covered it.
  const seenRunning = useRef(new Set<string>());
  for (const c of timers.chips)
    if (!c.ended && c.endsAt > timers.serverNow) seenRunning.current.add(c.key);
  const chips = timers.chips.filter((c) => c.failed || seenRunning.current.has(c.key));
  return { ...timers, chips };
}

/** Timers on the card: shown only while there are any, kept in view at the bottom. */
export function CardTimersPanel({ timers }: { timers: CookTimers }) {
  if (timers.chips.length === 0) return null;
  return (
    <div className="card-timers">
      <TimersPanel timers={timers} />
    </div>
  );
}
