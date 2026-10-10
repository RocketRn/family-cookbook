import type { ServerTimer } from '../api/cook';
import type { CookTimer } from './state';

/** "1:30:00", "10:00", "0:05": whole seconds, rounded up so a fresh timer shows its full length. */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec - 1e-6));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** A timer as the chips show it. `endsAt` is in milliseconds by the server's clock. */
export type TimerChip = {
  /** The device's own id: stays the same when an offline timer syncs. */
  key: string;
  serverId: string | null;
  clientId: string;
  label: string;
  stepId: string | null;
  endsAt: number;
  /** The server says it ended (fired, or failed to deliver its message). */
  ended: boolean;
  /** PRD 4.4: the bot could not deliver its message (blocked, or never started). */
  failed: boolean;
  /** Started without a connection: only on this screen until it syncs. */
  local: boolean;
};

/**
 * The chips: the server's active timers (all of the person's, PRD 4.6 #3), plus the timers this
 * device started offline that the server does not know yet. Without the server's list (offline),
 * what this device remembers.
 */
export function timerChips(server: ServerTimer[] | undefined, mine: CookTimer[]): TimerChip[] {
  const chips: TimerChip[] = [];
  const known = new Set<string>();
  for (const t of server ?? []) {
    if (t.status === 'cancelled') continue;
    known.add(t.client_timer_id);
    chips.push({
      key: t.client_timer_id,
      serverId: t.id,
      clientId: t.client_timer_id,
      label: t.label,
      stepId: t.step_id,
      endsAt: Date.parse(t.ends_at),
      ended: t.status !== 'running',
      failed: t.status === 'failed',
      local: false,
    });
  }
  for (const t of mine) {
    if (known.has(t.client_timer_id) || (server && t.synced)) continue;
    chips.push({
      key: t.client_timer_id,
      serverId: t.server_id,
      clientId: t.client_timer_id,
      label: t.label,
      stepId: t.step_id,
      endsAt: Date.parse(t.ends_at),
      ended: false,
      failed: false,
      local: !t.synced,
    });
  }
  return chips.sort((a, b) => a.endsAt - b.endsAt);
}

/** A random v4 uuid; crypto.randomUUID needs a secure page, getRandomValues does not. */
export function newClientId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
