import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { recipeApi } from '../api/recipeApi';
import { SEARCH_MAX_CHARS, toSummary, type RecipeFilters } from '../api/recipes';
import { Button } from '../design/Button';
import { EmptyState, ErrorState, Loading } from '../design/Feedback';
import { SearchField } from '../design/Fields';
import { errorMessage } from '../errors';
import { activeFilters, FilterSheet, useLocalFilters } from './FilterSheet';
import { RecipeListItem } from './RecipeCard';
import { isWaiting } from '../state/online';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * The personal "Saved" shelf (PRD UC-10, D-051): the recipes you saved with 🔖 on their card,
 * newest saved first, with search and the book's filters (its own choice, S6-7). Only those you
 * may still read are shown (the server decides).
 */
export function SavedScreen() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filters, controls] = useLocalFilters();
  const activeCount = activeFilters(filters);
  const hasCriteria = q !== '' || activeCount > 0;
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text]);
  const query: RecipeFilters = { scope: 'saved', q, ...filters };
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

  return (
    <div className="stack">
      <h1>{t('saved.title')}</h1>
      <div className="row">
        <div className="grow">
          <SearchField
            aria-label={t('book.search_placeholder')}
            placeholder={t('book.search_placeholder')}
            value={text}
            maxLength={SEARCH_MAX_CHARS}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <Button variant="secondary" onClick={() => setSheetOpen(true)}>
          {t('book.filters')}
          {activeCount > 0 ? ` (${activeCount})` : ''}
        </Button>
      </div>
      {isWaiting(list) && <Loading />}
      {list.isError && !list.data && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      )}
      {list.data && !list.isPlaceholderData && items.length === 0 && (
        <EmptyState
          icon={hasCriteria ? '🔍' : '🔖'}
          title={hasCriteria ? t('book.no_results_title') : t('saved.empty_title')}
          text={hasCriteria ? t('book.no_results_text') : t('saved.empty_text')}
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
      {list.hasNextPage && (
        <Button
          variant="secondary"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? t('common.loading') : t('book.load_more')}
        </Button>
      )}
      <FilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filters={filters}
        controls={controls}
      />
    </div>
  );
}
