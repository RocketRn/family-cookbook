import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { recipeApi } from '../api/recipeApi';
import { Loading } from '../design/Feedback';
import type { EditorState } from './EditorScreen';
import { reviewFor, startReview } from './importDraft';

/**
 * S6-2 (PRD 2.2 variant B step 6; D-054): the bot's "Check the recipe" for a recipe forwarded to
 * it opens here (`startapp=draft_<id>`). The review notes come from the server and the review then
 * goes on exactly like a pasted recipe's: kept on this device until the recipe is saved. A draft
 * saved since (no notes any more) opens in the editor as usual.
 */
export function DraftReviewScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const recipe = useQuery({ queryKey: ['recipe', id], queryFn: () => recipeApi.get(id!) });
  const notes = useQuery({
    queryKey: ['import-notes', id],
    queryFn: () => recipeApi.importNotes(id!),
    retry: false,
  });

  useEffect(() => {
    const edit = `/recipe/${id}/edit`;
    if (notes.isError) {
      navigate(edit, { replace: true });
      return;
    }
    const r = recipe.data;
    if (!r || !notes.data) return;
    if (reviewFor(r.id, r.version)) {
      // A review of this draft is already going on on this device: continue it.
      navigate(edit, { replace: true });
      return;
    }
    const imported = {
      original: notes.data.original,
      warnings: notes.data.warnings,
      reasons: notes.data.reasons,
    };
    startReview({
      recipe_id: r.id,
      recipe_version: r.version,
      title: r.title,
      ...imported,
      editor: null,
    });
    const state: EditorState = { imported };
    navigate(edit, { replace: true, state });
  }, [id, navigate, recipe.data, notes.data, notes.isError]);

  return <Loading />;
}
