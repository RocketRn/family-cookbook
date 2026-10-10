/**
 * Deep-link payloads from `t.me/<bot>/<app>?startapp=<payload>` (PRD 4.7).
 * Allowed alphabet A-Z a-z 0-9 _ - and 64 chars max are ASSUMPTIONS (docs/ASSUMPTIONS.md A-03).
 */
export type StartTarget =
  | { kind: 'recipe_by_link'; shareToken: string }
  | { kind: 'book_recipe'; recipeId: string }
  | { kind: 'join'; inviteCode: string }
  | { kind: 'draft'; draftId: string }
  | { kind: 'cook'; recipeId: string; step: number };

const PAYLOAD = /^[A-Za-z0-9_-]{1,64}$/;
const HEX32 = /^[0-9a-f]{32}$/i;

/** 32 hex chars -> canonical dashed uuid. */
export function undashedToUuid(hex: string): string | null {
  if (!HEX32.test(hex)) return null;
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function parseStartParam(raw: string | null | undefined): StartTarget | null {
  if (!raw || !PAYLOAD.test(raw)) return null;
  const sep = raw.indexOf('_');
  if (sep < 1) return null;
  const prefix = raw.slice(0, sep);
  const rest = raw.slice(sep + 1);
  if (!rest) return null;

  switch (prefix) {
    case 'r':
      return { kind: 'recipe_by_link', shareToken: rest };
    case 'rc': {
      const recipeId = undashedToUuid(rest);
      return recipeId ? { kind: 'book_recipe', recipeId } : null;
    }
    case 'join':
      return { kind: 'join', inviteCode: rest };
    case 'draft': {
      const draftId = undashedToUuid(rest);
      return draftId ? { kind: 'draft', draftId } : null;
    }
    case 'cook': {
      // cook_<uuid>_<step number>; the uuid may be dashed (36 chars) per PRD 4.7.
      const m = /^([0-9a-f-]{32,36})_(\d{1,3})$/i.exec(rest);
      if (!m) return null;
      const id = m[1]!.includes('-') ? m[1]! : undashedToUuid(m[1]!);
      return id ? { kind: 'cook', recipeId: id, step: Number(m[2]) } : null;
    }
    default:
      return null;
  }
}

/** Route inside the SPA for a start target, or null when the target has no screen yet. */
export function routeForTarget(t: StartTarget): string | null {
  switch (t.kind) {
    case 'join':
      return `/join/${encodeURIComponent(t.inviteCode)}`;
    case 'book_recipe':
      return `/recipe/${t.recipeId}`;
    case 'recipe_by_link':
      return `/r/${encodeURIComponent(t.shareToken)}`;
    case 'cook':
      // From a timer message (BE-08): cooking mode at the step the timer belongs to.
      return `/cook/${t.recipeId}?step=${t.step}`;
    case 'draft':
      // S6-2: the bot's "Check the recipe" for a recipe forwarded to it (D-054).
      return `/recipe/${t.draftId}/review`;
    default:
      return null;
  }
}
