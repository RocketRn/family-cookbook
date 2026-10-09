import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import {
  cancelTimer,
  extendTimer,
  listActiveTimers,
  startTimer,
  type ServerTimer,
  type TimerAnswer,
} from '../api/cook';
import type { Step } from '../api/types';
import { errorMessage } from '../errors';
import { useToastStore } from '../state/store';
import { getRuntime, haptic, requestWriteAccess } from '../telegram/sdk';
import type { CookState, CookTimer } from './state';
import { newClientId, timerChips, type TimerChip } from './timers';

type StepTimer = Step['timers'][number];
const LIST_KEY = ['timers', 'active'] as const;
/** While a timer waits to sync, try again this often (and at once when the connection returns). */
const RETRY_MS = 15_000;
/** PRD 4.5: the user's answer to "may the bot write to you?", for this app session. */
const WRITE_KEY = 'bot-write';

const isOffline = (err: unknown) => err instanceof ApiError && err.code === 'NETWORK';
const iso = (ms: number) => new Date(ms).toISOString();

function readChoice(): string | null {
  try {
    return sessionStorage.getItem(WRITE_KEY);
  } catch {
    return null;
  }
}
function writeChoice(v: 'granted' | 'declined'): void {
  try {
    sessionStorage.setItem(WRITE_KEY, v);
  } catch {
    /* unavailable: asked again next time */
  }
}

export type CookTimers = {
  chips: TimerChip[];
  /** The server's clock now, in milliseconds (PRD 4.6 #2). */
  serverNow: number;
  /** Labels that reached zero while the screen was open (the large notice). */
  ringing: string[];
  stopRinging: () => void;
  offline: boolean;
  /** The bot may write to this person (or they just allowed it). */
  botCanWrite: boolean;
  /** The timer waiting for the answer to "may the bot write to you?". */
  asking: boolean;
  answerAsk: (allow: boolean) => void;
  isRunning: (stepId: string, label: string) => boolean;
  start: (step: Step, timer: StepTimer) => void;
  extend: (chip: TimerChip) => void;
  cancel: (chip: TimerChip) => void;
};

/**
 * FE-09 (PRD 2.4 steps 7-11, 4.6; D-042): timers run on the server, so the bot sends its message
 * even when the app is closed. The screen counts down by the server's clock, rebuilds its chips
 * from GET /timers?active=1 when cooking starts and when the app comes back, and starts a local
 * timer when there is no connection, synced later with the same client_timer_id.
 */
export function useCookTimers({
  active,
  stRef,
  save,
  botStarted,
}: {
  active: boolean;
  stRef: MutableRefObject<CookState>;
  save: (next: CookState) => void;
  botStarted: boolean;
}): CookTimers {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToastStore((s) => s.show);
  const offset = useRef(0); // server clock minus this device's clock, in ms
  // Only makes the countdown redraw; the time itself is read fresh on every render.
  const [, setTick] = useState(0);
  const [ringing, setRinging] = useState<string[]>([]);
  const seen = useRef(new Map<string, boolean>()); // chip key -> was it over when first seen
  const [choice, setChoice] = useState(readChoice);
  const [pending, setPending] = useState<{ step: Step; timer: StepTimer } | null>(null);
  const syncing = useRef(false);
  /** Starts whose first request has not answered yet: the sync must not send them again. */
  const inflight = useRef(new Set<string>());

  const learnClock = (serverNow: string) => {
    const at = Date.parse(serverNow);
    if (Number.isFinite(at)) offset.current = at - Date.now();
  };

  // PRD 4.6 #3: refetched when cooking starts and when the app comes back to the front.
  const list = useQuery({
    queryKey: LIST_KEY,
    queryFn: async () => {
      const r = await listActiveTimers();
      learnClock(r.server_now);
      return r.timers;
    },
    enabled: active,
    retry: false,
  });

  const setTimers = (fn: (timers: CookTimer[]) => CookTimer[]) =>
    save({ ...stRef.current, timers: fn(stRef.current.timers) });
  /**
   * A list asked for before this change but answered after it would be out of date and would
   * erase what just happened (found in testing): it is cancelled before the change is applied.
   */
  const changeList = async (fn: (old: ServerTimer[]) => ServerTimer[]) => {
    await qc.cancelQueries({ queryKey: LIST_KEY });
    qc.setQueryData<ServerTimer[]>(LIST_KEY, (old) => fn(old ?? []));
  };
  const putInList = (timer: ServerTimer) =>
    changeList((old) => [...old.filter((x) => x.id !== timer.id), timer]);
  const synced = async (clientId: string, a: TimerAnswer) => {
    learnClock(a.server_now);
    await putInList(a.timer);
    setTimers((ts) =>
      ts.map((x) =>
        x.client_timer_id === clientId
          ? {
              ...x,
              server_id: a.timer.id,
              started_at: a.timer.started_at,
              ends_at: a.timer.ends_at,
              synced: true,
            }
          : x,
      ),
    );
  };
  const forget = (clientId: string) =>
    setTimers((ts) => ts.filter((x) => x.client_timer_id !== clientId));

  const body = (x: CookTimer) => {
    const s = stRef.current;
    return {
      client_timer_id: x.client_timer_id,
      recipe_id: s.recipe_id,
      ...(x.step_id ? { step_id: x.step_id } : {}),
      ...(s.session_id ? { cook_session_id: s.session_id } : {}),
      duration_sec: x.duration_sec,
      label: x.label,
    };
  };

  /** Offline timers to the server, oldest first, counted from when they really started. */
  const syncLocal = async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      const waiting = stRef.current.timers.filter(
        (y) => !y.synced && !inflight.current.has(y.client_timer_id),
      );
      for (const x of waiting) {
        try {
          await synced(
            x.client_timer_id,
            await startTimer({ ...body(x), started_at: x.started_at }),
          );
        } catch (err) {
          if (isOffline(err)) break;
          // Over already (TIMER_EXPIRED) or refused: retrying cannot help.
          forget(x.client_timer_id);
        }
      }
    } finally {
      syncing.current = false;
    }
  };

  const unsynced = stRef.current.timers.some((x) => !x.synced);
  useEffect(() => {
    if (!active) return;
    const onOnline = () => void syncLocal();
    const onVisible = () => document.visibilityState === 'visible' && void syncLocal();
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    const retry = unsynced ? setInterval(() => void syncLocal(), RETRY_MS) : undefined;
    if (unsynced) void syncLocal();
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(retry);
    };
  }, [active, unsynced]);

  // The server's list is the truth for synced timers: one it no longer lists (cancelled elsewhere,
  // or cleaned up) is forgotten, and a changed end (+1 min on another device) is taken over.
  useEffect(() => {
    if (!list.data) return;
    const byId = new Map(list.data.map((x) => [x.id, x]));
    const cur = stRef.current.timers;
    const next = cur
      .filter((x) => !x.synced || byId.has(x.server_id ?? ''))
      .map((x) => {
        const s = x.synced ? byId.get(x.server_id ?? '') : undefined;
        return s && s.ends_at !== x.ends_at
          ? { ...x, ends_at: s.ends_at, duration_sec: s.duration_sec }
          : x;
      });
    if (next.length !== cur.length || next.some((x, i) => x !== cur[i])) setTimers(() => next);
  }, [list.data]);

  const chips = active ? timerChips(list.data, stRef.current.timers) : [];
  const serverNow = Date.now() + offset.current;

  // The countdown ticks once a second while there is something to count.
  const counting = chips.some((c) => !c.ended && c.endsAt > serverNow);
  useEffect(() => {
    if (!counting) return;
    const tick = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, [counting]);

  // PRD 4.6 #4: a timer reaching zero on screen vibrates and shows a large notice (the bot's
  // message is still sent). One that was already over when it first appeared does not. Judged
  // only once the server's list has answered (or failed): the device's copy may be out of date.
  const listSettled = list.isSuccess || list.isError;
  useEffect(() => {
    if (!listSettled) return;
    const due: string[] = [];
    for (const c of chips) {
      const over = c.ended || c.endsAt <= serverNow;
      const was = seen.current.get(c.key);
      if (was === undefined) seen.current.set(c.key, over);
      else if (!was && over) {
        seen.current.set(c.key, true);
        due.push(c.label);
      }
    }
    if (due.length) {
      haptic('warning');
      setRinging((r) => [...r, ...due]);
    }
  });

  const tgUser = getRuntime().webApp.initDataUnsafe.user;
  const botCanWrite = botStarted || tgUser?.allows_write_to_pm === true || choice === 'granted';

  const begin = async (step: Step, timer: StepTimer) => {
    const startedAt = Date.now() + offset.current;
    const x: CookTimer = {
      client_timer_id: newClientId(),
      server_id: null,
      step_id: step.id,
      label: timer.label.slice(0, 100),
      duration_sec: timer.duration_sec,
      started_at: iso(startedAt),
      ends_at: iso(startedAt + timer.duration_sec * 1000),
      synced: false,
    };
    haptic('select');
    inflight.current.add(x.client_timer_id);
    setTimers((ts) => [...ts, x]); // first on this device, so nothing is lost if the app closes
    try {
      // Online, the server's own clock decides when it started (a phone's clock may be wrong).
      await synced(x.client_timer_id, await startTimer(body(x)));
    } catch (err) {
      if (isOffline(err)) return; // a local timer, with the notice; it syncs later
      forget(x.client_timer_id);
      toast(errorMessage(t, err));
    } finally {
      inflight.current.delete(x.client_timer_id);
    }
  };

  const failed = (err: unknown) => {
    toast(errorMessage(t, err));
    void list.refetch();
  };

  return {
    chips,
    serverNow,
    ringing,
    stopRinging: () => setRinging([]),
    offline: chips.some((c) => c.local),
    botCanWrite,
    asking: pending !== null,
    answerAsk: (allow) => {
      const p = pending;
      setPending(null);
      const go = (granted: boolean | null) => {
        // null: this Telegram client cannot ask; nothing is remembered then.
        if (granted !== null) {
          const v = granted ? 'granted' : 'declined';
          writeChoice(v);
          setChoice(v);
        }
        if (p) void begin(p.step, p.timer);
      };
      if (allow) void requestWriteAccess().then(go);
      else go(false);
    },
    isRunning: (stepId, label) =>
      chips.some(
        (c) => c.stepId === stepId && c.label === label && !c.ended && c.endsAt > serverNow,
      ),
    start: (step, timer) => {
      // PRD 4.5: before the first timer, explain and ask once; the timer starts either way.
      if (!botCanWrite && choice === null) setPending({ step, timer });
      else void begin(step, timer);
    },
    extend: (chip) => {
      if (!chip.serverId || chip.local) return;
      extendTimer(chip.serverId, 60)
        .then(async (a) => {
          learnClock(a.server_now);
          await putInList(a.timer);
          setTimers((ts) =>
            ts.map((x) =>
              x.server_id === a.timer.id
                ? { ...x, ends_at: a.timer.ends_at, duration_sec: a.timer.duration_sec }
                : x,
            ),
          );
        })
        .catch(failed);
    },
    cancel: (chip) => {
      if (chip.local || !chip.serverId) return forget(chip.clientId);
      const id = chip.serverId;
      cancelTimer(id)
        .then(async () => {
          await changeList((old) => old.filter((x) => x.id !== id));
          forget(chip.clientId);
        })
        .catch(failed);
    },
  };
}
