import { api } from './endpoints';
import type { Photo } from './types';

/** BE-10 reactions (PRD 3.2; D-048). "My version" stays hidden until stage 2. */
export const ONE_EACH = ['heart', 'yum', 'fire', 'idea', 'curious', 'cook_again'] as const;
export type OneEach = (typeof ONE_EACH)[number];
export type ReactionKind = OneEach | 'cooked';

export type CookedMark = {
  id: string;
  cook_name: string | null;
  note: string | null;
  photo: Photo | null;
  created_at: string;
  mine: boolean;
};
export type ReactionSummary = {
  counts: Record<ReactionKind, number>;
  /** Your own: the id of each one-of reaction (or null), and how often you cooked it. */
  mine: Record<OneEach, string | null> & { cooked: number };
  /** "I cooked it" with photo and words: all of them for the author, else only your own. */
  cooked: CookedMark[];
};
export type CookedBody = {
  kind: 'cooked';
  note?: string;
  photo_media_id?: string;
  cook_session_id?: string;
};

const path = (recipeId: string) => `/recipes/${encodeURIComponent(recipeId)}/reactions`;

export const getReactions = (recipeId: string) =>
  api().request<ReactionSummary>('GET', path(recipeId));
export const addReaction = (recipeId: string, body: { kind: OneEach } | CookedBody) =>
  api().request<{ reaction: { id: string }; summary: ReactionSummary }>(
    'POST',
    path(recipeId),
    body,
  );
export const removeReaction = (id: string) =>
  api().request<void>('DELETE', `/reactions/${encodeURIComponent(id)}`);
