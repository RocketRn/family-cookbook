import { create } from 'zustand';
import {
  EMPTY_FILTERS,
  type Difficulty,
  type RecipeFilters,
  type RecipeScope,
} from '../api/recipes';

type FilterState = {
  filters: RecipeFilters;
  setQuery(q: string): void;
  setScope(scope: RecipeScope): void;
  setDifficulty(d: Difficulty | null): void;
  setMaxMin(m: number | null): void;
  toggleTag(tag: string): void;
  resetFilters(): void;
};

export const useFilterStore = create<FilterState>((set) => ({
  filters: EMPTY_FILTERS,
  setQuery: (q) => set((s) => ({ filters: { ...s.filters, q } })),
  setScope: (scope) => set((s) => ({ filters: { ...s.filters, scope } })),
  setDifficulty: (difficulty) => set((s) => ({ filters: { ...s.filters, difficulty } })),
  setMaxMin: (maxMin) => set((s) => ({ filters: { ...s.filters, maxMin } })),
  toggleTag: (tag) =>
    set((s) => ({
      filters: {
        ...s.filters,
        tags: s.filters.tags.includes(tag)
          ? s.filters.tags.filter((x) => x !== tag)
          : [...s.filters.tags, tag],
      },
    })),
  resetFilters: () =>
    set((s) => ({ filters: { ...EMPTY_FILTERS, scope: s.filters.scope, q: s.filters.q } })),
}));

type ToastState = { message: string | null; show(message: string): void };
let timer: ReturnType<typeof setTimeout> | undefined;
export const useToastStore = create<ToastState>((set) => ({
  message: null,
  show: (message) => {
    set({ message });
    clearTimeout(timer);
    timer = setTimeout(() => set({ message: null }), 2500);
  },
}));

/**
 * Unsaved changes (FE-04 editor): while `message` is set, the Back button asks before leaving and
 * Telegram asks before closing the Mini App.
 */
type LeaveGuardState = { message: string | null; set(message: string | null): void };
export const useLeaveGuard = create<LeaveGuardState>((set) => ({
  message: null,
  set: (message) => set({ message }),
}));
