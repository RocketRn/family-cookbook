import { describe, expect, it } from 'vitest';
import { parseStartParam, routeForTarget, undashedToUuid } from '../src/telegram/startParam';

const HEX = '0123456789abcdef0123456789abcdef';
const UUID = '01234567-89ab-cdef-0123-456789abcdef';

describe('parseStartParam', () => {
  it.each([
    ['r_abc-DEF_123', { kind: 'recipe_by_link', shareToken: 'abc-DEF_123' }],
    [`rc_${HEX}`, { kind: 'book_recipe', recipeId: UUID }],
    ['join_devinvitecode', { kind: 'join', inviteCode: 'devinvitecode' }],
    [`draft_${HEX}`, { kind: 'draft', draftId: UUID }],
    [`cook_${HEX}_3`, { kind: 'cook', recipeId: UUID, step: 3 }],
    [`cook_${UUID}_12`, { kind: 'cook', recipeId: UUID, step: 12 }],
  ])('parses %s', (raw, expected) => {
    expect(parseStartParam(raw)).toEqual(expected);
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['join'],
    ['join_'],
    ['unknown_x'],
    ['rc_nothex'],
    ['draft_123'],
    ['cook_abc_1'],
    ['r_has space'],
    ['r_ünicode'],
    ['r_' + 'a'.repeat(70)],
  ])('rejects %s', (raw) => {
    expect(parseStartParam(raw as string | null | undefined)).toBeNull();
  });

  it('converts 32 hex chars to a dashed uuid', () => {
    expect(undashedToUuid(HEX)).toBe(UUID);
    expect(undashedToUuid('xyz')).toBeNull();
  });

  it('routes targets that have a screen; a timer message opens cooking mode at its step', () => {
    expect(routeForTarget({ kind: 'join', inviteCode: 'a b' })).toBe('/join/a%20b');
    expect(routeForTarget({ kind: 'book_recipe', recipeId: UUID })).toBe(`/recipe/${UUID}`);
    expect(routeForTarget({ kind: 'recipe_by_link', shareToken: 'tok' })).toBe('/r/tok');
    // S6-2: the bot's "Check the recipe" for a forwarded recipe.
    expect(routeForTarget({ kind: 'draft', draftId: UUID })).toBe(`/recipe/${UUID}/review`);
    expect(routeForTarget({ kind: 'cook', recipeId: UUID, step: 3 })).toBe(`/cook/${UUID}?step=3`);
  });
});
