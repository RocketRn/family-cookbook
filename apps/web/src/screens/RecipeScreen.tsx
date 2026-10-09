import type { Lang } from '@cookbook/recipe-core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { recipeApi } from '../api/recipeApi';
import { emojiFor } from '../api/recipes';
import type { Photo, Recipe } from '../api/types';
import { Button } from '../design/Button';
import { Tag } from '../design/Chip';
import { EmptyState, ErrorState, Loading } from '../design/Feedback';
import { errorMessage } from '../errors';
import { isLanguage } from '../i18n';
import { recipeLangOf } from '../recipe/amounts';
import { Gallery } from '../recipe/Gallery';
import { IngredientList } from '../recipe/IngredientList';
import { Reactions } from '../recipe/Reactions';
import { StepList } from '../recipe/StepList';
import { VideoPlayer } from '../recipe/VideoPlayer';
import { useToastStore } from '../state/store';
import { confirmDialog } from '../telegram/sdk';

/** Cover first, then step photos; a photo used twice is shown once. */
function galleryPhotos(r: Recipe): Photo[] {
  const seen = new Set<string>();
  return [r.cover, ...r.steps.map((s) => s.photo)].filter((p): p is Photo => {
    if (!p || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

/** FE-03 recipe card (PRD 1.4): photos, ingredients, steps with photos, timers and video, notes. */
export function RecipeScreen() {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams();
  const recipe = useQuery({ queryKey: ['recipe', id], queryFn: () => recipeApi.get(id) });

  if (recipe.isLoading) return <Loading />;
  // A failed request is not "not found": show why and offer a retry.
  if (recipe.isError)
    return <ErrorState error={recipe.error} onRetry={() => void recipe.refetch()} />;
  const r = recipe.data;
  if (!r) return <EmptyState icon={'🍽️'} title={t('recipe.not_found')} />;

  const uiLang: Lang = isLanguage(i18n.language) ? i18n.language : 'en';
  const langs = { recipeLang: recipeLangOf(r, uiLang), uiLang };
  // Recipe texts keep their own language (PRD 1.5 #5); `lang` lets screen readers read them right.
  const lang = r.language ?? undefined;
  const stepVideoIds = new Set(r.steps.map((s) => s.video_id));
  const otherVideos = r.videos.filter((v) => !stepVideoIds.has(v.id));
  const recalcLabel = `${t('recipe.recalculate')} · ${t('common.coming_soon')}`;
  const cookLabel = `${t('recipe.cook')} · ${t('common.coming_soon')}`;
  const totalMin =
    r.prep_min === null && r.cook_min === null ? null : (r.prep_min ?? 0) + (r.cook_min ?? 0);

  return (
    <article className="stack">
      <Gallery photos={galleryPhotos(r)} title={r.title} emoji={emojiFor(r.tags)} />
      <div className="stack stack--tight">
        <h1 lang={lang}>{r.title}</h1>
        <p className="hint">
          {t('recipe.by_author', { name: r.author.name ?? t('recipe.former_member') })}
        </p>
      </div>
      <div className="row row--wrap">
        {r.is_mine && r.status === 'draft' && <Tag>{t('recipe.draft')}</Tag>}
        {r.is_mine && <Tag>{t(`recipe.visibility.${r.visibility}`)}</Tag>}
        {r.difficulty && <Tag>{t(`difficulty.${r.difficulty}`)}</Tag>}
        {totalMin !== null && <Tag>{t('recipe.minutes', { count: totalMin })}</Tag>}
        {r.tags.map((tag) => (
          <Tag key={tag.slug}>
            {tag.custom_name ? <span lang={lang}>{tag.custom_name}</span> : t(`tags.${tag.slug}`)}
          </Tag>
        ))}
      </div>
      {(r.prep_min !== null || r.cook_min !== null) && (
        <p className="hint">
          {[
            r.prep_min !== null ? t('recipe.prep', { count: r.prep_min }) : null,
            r.cook_min !== null ? t('recipe.cook_time', { count: r.cook_min }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}

      <div className="row">
        <Button className="grow" variant="secondary" disabled>
          {recalcLabel}
        </Button>
        <Button className="grow" disabled>
          {cookLabel}
        </Button>
      </div>

      {r.ingredients.length > 0 && (
        <IngredientList
          ingredients={r.ingredients}
          servings={r.servings}
          langs={langs}
          lang={lang}
        />
      )}
      {r.steps.length > 0 && (
        <StepList
          steps={r.steps}
          ingredients={r.ingredients}
          videos={r.videos}
          langs={langs}
          lang={lang}
        />
      )}
      {otherVideos.length > 0 && (
        <section className="section stack stack--tight" aria-labelledby="videos-h">
          <h2 id="videos-h">{t('recipe.videos')}</h2>
          {otherVideos.map((v) => (
            <VideoPlayer key={v.id} video={v} startSec={null} />
          ))}
        </section>
      )}
      {r.author_notes && (
        <section className="section stack stack--tight" aria-labelledby="notes-h">
          <h2 id="notes-h">{t('recipe.author_notes')}</h2>
          <p className="pre-line" lang={lang}>
            {r.author_notes}
          </p>
        </section>
      )}
      <Reactions />
      <RecipeActions recipe={r} />
    </article>
  );
}

/**
 * The author edits or deletes; the author or the book keeper unpublishes (PRD 3.3, 4.9). Both
 * destructive actions ask first.
 */
function RecipeActions({ recipe: r }: { recipe: Recipe }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToastStore((s) => s.show);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shared = r.status === 'published' && r.visibility !== 'private';
  const canUnpublish = r.can_unpublish && shared;
  if (!r.can_edit && !canUnpublish) return null;

  async function act(question: string, run: () => Promise<void>, done: string, leave: boolean) {
    if (!(await confirmDialog(question))) return;
    setBusy(true);
    setError(null);
    try {
      await run();
      void qc.invalidateQueries({ queryKey: ['recipes'] });
      toast(done);
      if (leave) {
        qc.removeQueries({ queryKey: ['recipe', r.id] });
        navigate('/', { replace: true });
      } else await qc.invalidateQueries({ queryKey: ['recipe', r.id] });
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack stack--tight" aria-label={t('recipe.actions')}>
      {r.can_edit && (
        <Button variant="secondary" onClick={() => navigate(`/recipe/${r.id}/edit`)}>
          {t('recipe.edit')}
        </Button>
      )}
      {canUnpublish && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void act(
              t('recipe.unpublish_confirm'),
              () => recipeApi.unpublish(r.id),
              t('recipe.unpublished'),
              false,
            )
          }
        >
          {t('recipe.unpublish')}
        </Button>
      )}
      {r.can_edit && (
        <Button
          variant="danger"
          disabled={busy}
          onClick={() =>
            void act(
              t('recipe.delete_confirm'),
              () => recipeApi.remove(r.id),
              t('recipe.deleted'),
              true,
            )
          }
        >
          {t('recipe.delete')}
        </Button>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
