import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { recipeApi } from '../api/recipeApi';
import { SEARCH_MAX_CHARS, toSummary } from '../api/recipes';
import { BottomSheet } from '../design/BottomSheet';
import { Button } from '../design/Button';
import { Chip } from '../design/Chip';
import { EmptyState, ErrorState, Loading } from '../design/Feedback';
import { errorMessage } from '../errors';
import { SearchField } from '../design/Fields';
import { useFilterStore } from '../state/store';
import { activeFilters, FilterSheet } from './FilterSheet';
import { RecipeListItem } from './RecipeCard';
import { isWaiting } from '../state/online';
import { Tip } from '../design/Tip';

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
  const [addOpen, setAddOpen] = useState(false);
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
  const activeCount = activeFilters(filters);
  const hasCriteria = activeCount > 0 || filters.q.trim() !== '';
  const more = list.hasNextPage;

  return (
    <div className="stack">
      <div className="row row--between">
        <h1>{bookTitle}</h1>
        <Button aria-label={t('book.new_recipe')} onClick={() => setAddOpen(true)}>
          {'＋'}
        </Button>
      </div>
      <Tip id="forward" />
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

      {isWaiting(list) && <Loading />}
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

      {/* PRD 2.2: "＋" -> write a recipe, or paste its text (variant A). */}
      <BottomSheet open={addOpen} title={t('book.new_recipe')} onClose={() => setAddOpen(false)}>
        <div className="stack stack--tight">
          <button type="button" className="option" onClick={() => navigate('/recipe/new')}>
            <strong>{t('book.add_write')}</strong>
            <span className="hint">{t('book.add_write_hint')}</span>
          </button>
          <button type="button" className="option" onClick={() => navigate('/import')}>
            <strong>{t('book.add_paste')}</strong>
            <span className="hint">{t('book.add_paste_hint')}</span>
          </button>
        </div>
      </BottomSheet>

      <FilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filters={filters}
        controls={store}
      />
    </div>
  );
}
