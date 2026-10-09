import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { recipeApi } from '../api/recipeApi';
import type { Difficulty } from '../api/recipes';
import { BottomSheet } from '../design/BottomSheet';
import { Button } from '../design/Button';
import { Chip } from '../design/Chip';
import { EmptyState } from '../design/Feedback';
import { SearchField } from '../design/Fields';
import { useFilterStore } from '../state/store';
import { RecipeListItem } from './RecipeCard';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const TIME_LIMITS = [30, 60, 120];
export const SYSTEM_TAGS = ['soup', 'main', 'salad', 'breakfast', 'baking', 'dessert', 'vegan'];

export function BookScreen({ bookTitle }: { bookTitle: string }) {
  const { t } = useTranslation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const store = useFilterStore();
  const { filters } = store;

  // keepPreviousData: the list stays on screen while a new search/filter result loads (no flicker per keystroke).
  const list = useQuery({
    queryKey: ['recipes', filters],
    queryFn: () => recipeApi.list(filters),
    placeholderData: keepPreviousData,
  });
  const activeCount =
    (filters.difficulty ? 1 : 0) + (filters.maxMin !== null ? 1 : 0) + filters.tags.length;
  const items = list.data ?? [];
  const hasCriteria = activeCount > 0 || filters.q.trim() !== '';

  return (
    <div className="stack">
      <div>
        <h1>{bookTitle}</h1>
        {list.data && <p className="hint">{t('book.recipes_count', { count: items.length })}</p>}
      </div>

      <div className="row">
        <div className="grow">
          <SearchField
            aria-label={t('book.search_placeholder')}
            placeholder={t('book.search_placeholder')}
            value={filters.q}
            onChange={(e) => store.setQuery(e.target.value)}
          />
        </div>
        <Button variant="secondary" onClick={() => setSheetOpen(true)}>
          {t('book.filters')}
          {activeCount > 0 ? ` (${activeCount})` : ''}
        </Button>
      </div>

      <div className="row row--wrap" role="group" aria-label={t('book.scope_book')}>
        <Chip selected={filters.scope === 'book'} onToggle={() => store.setScope('book')}>
          {t('book.scope_book')}
        </Chip>
        <Chip selected={filters.scope === 'mine'} onToggle={() => store.setScope('mine')}>
          {t('book.scope_mine')}
        </Chip>
      </div>

      {list.isLoading && (
        <p className="hint" role="status">
          {t('common.loading')}
        </p>
      )}
      {list.isError && <Button onClick={() => list.refetch()}>{t('common.retry')}</Button>}
      {list.data && items.length === 0 && (
        <EmptyState
          icon={hasCriteria ? '🔍' : '📖'}
          title={hasCriteria ? t('book.no_results_title') : t('book.empty_title')}
          text={hasCriteria ? t('book.no_results_text') : t('book.empty_text')}
        />
      )}
      <div className="stack stack--tight">
        {items.map((r) => (
          <RecipeListItem key={r.id} recipe={r} />
        ))}
      </div>

      <BottomSheet open={sheetOpen} title={t('book.filters')} onClose={() => setSheetOpen(false)}>
        <div className="stack">
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">{t('filters.difficulty')}</legend>
            <div className="row row--wrap">
              <Chip
                selected={filters.difficulty === null}
                onToggle={() => store.setDifficulty(null)}
              >
                {t('filters.any')}
              </Chip>
              {DIFFICULTIES.map((d) => (
                <Chip
                  key={d}
                  selected={filters.difficulty === d}
                  onToggle={() => store.setDifficulty(d)}
                >
                  {t(`difficulty.${d}`)}
                </Chip>
              ))}
            </div>
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">{t('filters.time')}</legend>
            <div className="row row--wrap">
              <Chip selected={filters.maxMin === null} onToggle={() => store.setMaxMin(null)}>
                {t('filters.any')}
              </Chip>
              {TIME_LIMITS.map((m) => (
                <Chip key={m} selected={filters.maxMin === m} onToggle={() => store.setMaxMin(m)}>
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
                  onToggle={() => store.toggleTag(tag)}
                >
                  {t(`tags.${tag}`)}
                </Chip>
              ))}
            </div>
          </fieldset>
          <div className="row">
            <Button variant="ghost" onClick={store.resetFilters}>
              {t('book.filters_reset')}
            </Button>
            <Button className="grow" onClick={() => setSheetOpen(false)}>
              {t('book.filters_apply')}
            </Button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
