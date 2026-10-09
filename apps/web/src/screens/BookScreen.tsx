import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { recipeApi } from '../api/recipeApi';
import { SEARCH_MAX_CHARS, toSummary, type Difficulty } from '../api/recipes';
import { BottomSheet } from '../design/BottomSheet';
import { Button } from '../design/Button';
import { Chip } from '../design/Chip';
import { EmptyState, ErrorState, Loading } from '../design/Feedback';
import { errorMessage } from '../errors';
import { SearchField } from '../design/Fields';
import { useFilterStore } from '../state/store';
import { RecipeListItem } from './RecipeCard';

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

/** Wait until the user stops typing before asking the server again. */
export const SEARCH_DEBOUNCE_MS = 300;
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

export function BookScreen({ bookTitle }: { bookTitle: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  const store = useFilterStore();
  const { filters } = store;

  // Pages of 50 from the API, which applies the scope, the search text and the filters (BE-11).
  // While a new search loads, the previous results stay on screen.
  const q = useDebounced(filters.q.trim(), SEARCH_DEBOUNCE_MS);
  const query = { ...filters, q };
  const list = useInfiniteQuery({
    queryKey: ['recipes', query],
    queryFn: ({ pageParam }) => recipeApi.listPage(query, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    placeholderData: keepPreviousData,
  });
  const items = useMemo(
    () => list.data?.pages.flatMap((p) => p.items.map(toSummary)) ?? [],
    [list.data],
  );
  const activeCount =
    (filters.difficulty ? 1 : 0) + (filters.maxMin !== null ? 1 : 0) + filters.tags.length;
  const hasCriteria = activeCount > 0 || filters.q.trim() !== '';
  const more = list.hasNextPage;

  return (
    <div className="stack">
      <div className="row row--between">
        <h1>{bookTitle}</h1>
        <Button aria-label={t('book.new_recipe')} onClick={() => navigate('/recipe/new')}>
          {'＋'}
        </Button>
      </div>
      <div>
        {list.data && (
          <p className="hint" aria-live="polite">
            {hasCriteria
              ? more
                ? t('book.found_more', { count: items.length })
                : t('book.found', { count: items.length })
              : more
                ? t('book.recipes_loaded', { count: items.length })
                : t('book.recipes_count', { count: items.length })}
          </p>
        )}
      </div>

      <div className="row">
        <div className="grow">
          <SearchField
            aria-label={t('book.search_placeholder')}
            placeholder={t('book.search_placeholder')}
            value={filters.q}
            maxLength={SEARCH_MAX_CHARS}
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

      {list.isLoading && <Loading />}
      {list.isError && !list.data && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      )}
      {list.data && !list.isPlaceholderData && items.length === 0 && (
        <EmptyState
          icon={hasCriteria ? '🔍' : '📖'}
          title={
            hasCriteria
              ? t('book.no_results_title')
              : filters.scope === 'mine'
                ? t('book.empty_mine_title')
                : t('book.empty_title')
          }
          text={
            hasCriteria
              ? t('book.no_results_text')
              : filters.scope === 'mine'
                ? t('book.empty_mine_text')
                : t('book.empty_text')
          }
        />
      )}
      <div className="stack stack--tight">
        {items.map((r) => (
          <RecipeListItem key={r.id} recipe={r} />
        ))}
      </div>
      {list.isFetchNextPageError && (
        <p className="error-text" role="alert">
          {errorMessage(t, list.error)}
        </p>
      )}
      {more && (
        <Button
          variant="secondary"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? t('common.loading') : t('book.load_more')}
        </Button>
      )}

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
