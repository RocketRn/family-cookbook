import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Difficulty, RecipeFilters } from '../api/recipes';
import { BottomSheet } from '../design/BottomSheet';
import { Button } from '../design/Button';
import { Chip } from '../design/Chip';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const TIME_LIMITS = [30, 60, 120];
/** The system tags seeded by migration 0004 (PRD 3.2 tags). */
export const SYSTEM_TAGS = [
  'soup',
  'main',
  'salad',
  'breakfast',
  'baking',
  'dessert',
  'vegan',
  'gluten_free',
  'lean',
];

export type FilterChoice = Pick<RecipeFilters, 'difficulty' | 'maxMin' | 'tags'>;
export type FilterControls = {
  setDifficulty(d: Difficulty | null): void;
  setMaxMin(m: number | null): void;
  toggleTag(tag: string): void;
  resetFilters(): void;
};
export const NO_FILTERS: FilterChoice = { difficulty: null, maxMin: null, tags: [] };

/** How many filters are chosen (shown on the "Filters" button). */
export const activeFilters = (f: FilterChoice): number =>
  (f.difficulty ? 1 : 0) + (f.maxMin !== null ? 1 : 0) + f.tags.length;

/** S6-7: filters kept by one screen only (the "Saved" tab), apart from the book's. */
export function useLocalFilters(): [FilterChoice, FilterControls] {
  const [f, setF] = useState<FilterChoice>(NO_FILTERS);
  return [
    f,
    {
      setDifficulty: (difficulty) => setF((x) => ({ ...x, difficulty })),
      setMaxMin: (maxMin) => setF((x) => ({ ...x, maxMin })),
      toggleTag: (tag) =>
        setF((x) => ({
          ...x,
          tags: x.tags.includes(tag) ? x.tags.filter((t) => t !== tag) : [...x.tags, tag],
        })),
      resetFilters: () => setF(NO_FILTERS),
    },
  ];
}

/** Difficulty, total time and tags (PRD 4.9, BE-11): the book and the "Saved" tab. */
export function FilterSheet({
  open,
  onClose,
  filters,
  controls,
}: {
  open: boolean;
  onClose: () => void;
  filters: FilterChoice;
  controls: FilterControls;
}) {
  const { t } = useTranslation();
  return (
    <BottomSheet open={open} title={t('book.filters')} onClose={onClose}>
      <div className="stack">
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">{t('filters.difficulty')}</legend>
          <div className="row row--wrap">
            <Chip
              selected={filters.difficulty === null}
              onToggle={() => controls.setDifficulty(null)}
            >
              {t('filters.any')}
            </Chip>
            {DIFFICULTIES.map((d) => (
              <Chip
                key={d}
                selected={filters.difficulty === d}
                onToggle={() => controls.setDifficulty(d)}
              >
                {t(`difficulty.${d}`)}
              </Chip>
            ))}
          </div>
        </fieldset>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">{t('filters.time')}</legend>
          <div className="row row--wrap">
            <Chip selected={filters.maxMin === null} onToggle={() => controls.setMaxMin(null)}>
              {t('filters.any')}
            </Chip>
            {TIME_LIMITS.map((m) => (
              <Chip key={m} selected={filters.maxMin === m} onToggle={() => controls.setMaxMin(m)}>
                {t('filters.up_to_minutes', { count: m })}
              </Chip>
            ))}
          </div>
        </fieldset>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">{t('filters.tags')}</legend>
          <div className="row row--wrap">
            {SYSTEM_TAGS.map((tag) => (
              <Chip
                key={tag}
                selected={filters.tags.includes(tag)}
                onToggle={() => controls.toggleTag(tag)}
              >
                {t(`tags.${tag}`)}
              </Chip>
            ))}
          </div>
        </fieldset>
        <div className="row">
          <Button variant="ghost" onClick={controls.resetFilters}>
            {t('book.filters_reset')}
          </Button>
          <Button className="grow" onClick={onClose}>
            {t('book.filters_apply')}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
