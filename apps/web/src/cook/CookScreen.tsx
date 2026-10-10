import type { Lang } from '@cookbook/recipe-core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { patchCookSession, startCookSession } from '../api/cook';
import type { Me } from '../api/endpoints';
import { recipeApi } from '../api/recipeApi';
import type { Recipe, Step } from '../api/types';
import { Button } from '../design/Button';
import { EmptyState, ErrorState, Loading } from '../design/Feedback';
import { isLanguage } from '../i18n';
import {
  amountText,
  groupIngredients,
  photoSrcSet,
  recipeLangOf,
  stepBodyParts,
} from '../recipe/amounts';
import { readRecalc, writeRecalc } from '../recipe/recalc';
import { servingsText } from '../recipe/RecalcSheet';
import { VideoPlayer } from '../recipe/VideoPlayer';
import { useToastStore } from '../state/store';
import { haptic } from '../telegram/sdk';
import {
  clearCook,
  newCookState,
  readCook,
  scaleFromRecalc,
  writeCook,
  type CookState,
} from './state';
import { TimerAlarm, TimerButtons, TimersPanel, WriteAccessSheet } from './TimerParts';
import { useCookTimers, type CookTimers } from './useCookTimers';
import { useWakeLock } from './wakeLock';
import { isWaiting } from '../state/online';
import { Tip } from '../design/Tip';

type Phase = 'resume' | 'prep' | 'step' | 'done';
type Langs = { recipeLang: Lang; uiLang: Lang };

/** The furthest step goes to the server after this pause (PRD 4.8: a backup, best effort). */
const PROGRESS_DELAY_MS = 500;
/** A swipe is at least this long, or a quarter of the step's width, and more sideways than down. */
const SWIPE_MIN_PX = 60;

const sortedSteps = (r: Recipe): Step[] => [...r.steps].sort((a, b) => a.position - b.position);
const lastIndex = (r: Recipe) => Math.max(0, r.steps.length - 1);

/**
 * FE-08 cooking mode (PRD 2.4, 4.8; D-041): Preparation, one step per screen, Done. The progress
 * lives on this device (`cook:<recipe_id>`) with a copy of the recipe, so cooking goes on after a
 * reload or without a connection, and finishes on the version it started with.
 */
export function CookScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const [search] = useSearchParams();
  const asked = Number(search.get('step'));
  // From a timer message (cook_<id>_<n>, PRD 4.7): straight to that step, numbered from 1.
  const deepStep = Number.isInteger(asked) && asked >= 1 ? asked : null;
  const [saved] = useState(() => readCook(id));
  // A guest cooks a recipe shared by link (S6-3, D-055): it is read with the link's token, which
  // the progress keeps, so cooking opened again later (e.g. from a timer's message) still reads it.
  const token = search.get('t') ?? saved?.share_token ?? null;
  const fresh = useQuery({
    queryKey: token ? ['recipe-link', token] : ['recipe', id],
    queryFn: () => (token ? recipeApi.getByLink(token) : recipeApi.get(id)),
  });

  // With progress on this device, cooking does not wait for the network.
  if (!saved) {
    if (isWaiting(fresh)) return <Loading />;
    if (fresh.isError)
      return <ErrorState error={fresh.error} onRetry={() => void fresh.refetch()} />;
    if (!fresh.data) return <EmptyState icon={'🍽️'} title={t('recipe.not_found')} />;
  }
  return (
    <Cooking
      key={id}
      saved={saved}
      fresh={fresh.data ?? undefined}
      deepStep={deepStep}
      botStarted={me.bot_started}
      shareToken={token ?? undefined}
    />
  );
}

function initial(
  saved: CookState | null,
  fresh: Recipe | undefined,
  deepStep: number | null,
  shareToken: string | undefined,
): { st: CookState; phase: Phase } {
  if (saved?.started) {
    if (deepStep === null) return { st: saved, phase: 'resume' };
    return {
      st: { ...saved, step_index: Math.min(deepStep - 1, lastIndex(saved.recipe)) },
      phase: 'step',
    };
  }
  const base = saved ?? newCookState(fresh!, readRecalc(fresh!), shareToken);
  if (deepStep === null) return { st: base, phase: 'prep' };
  return {
    st: { ...base, started: true, step_index: Math.min(deepStep - 1, lastIndex(base.recipe)) },
    phase: 'step',
  };
}

function Cooking({
  saved,
  fresh,
  deepStep,
  botStarted,
  shareToken,
}: {
  saved: CookState | null;
  fresh: Recipe | undefined;
  deepStep: number | null;
  botStarted: boolean;
  shareToken: string | undefined;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToastStore((s) => s.show);
  const [start] = useState(() => initial(saved, fresh, deepStep, shareToken));
  /** The guest's link token: sent with the session and timers; no "I cooked it" (owner). */
  const guest = start.st.share_token;
  const withToken = guest ? { share_token: guest } : {};
  const [st, setSt] = useState(start.st);
  const [phase, setPhase] = useState<Phase>(start.phase);
  const stRef = useRef(st);
  const finished = useRef(false);
  const reached = useRef(0);
  const sent = useRef(0);

  const save = (next: CookState) => {
    if (finished.current) return; // after Done nothing is written back
    const written = writeCook(next);
    stRef.current = written;
    setSt(written);
  };

  const beginSession = (s: CookState) => {
    startCookSession({
      recipe_id: s.recipe_id,
      recipe_version: s.recipe_version,
      scale_factor: s.scale?.k ?? 1,
      ...withToken,
    })
      .then((session) => {
        if (stRef.current.started) save({ ...stRef.current, session_id: session.id });
      })
      .catch(() => undefined); // analytics only: cooking never waits for it
  };

  // Opened at a step (a timer message): remember it, and start a session if there is none.
  // From the current state, not the one it opened with: a timer may already have been started
  // before this effect ran, and writing the opening state back would erase it (found in CI).
  useEffect(() => {
    if (start.phase !== 'step') return;
    save(stRef.current);
    if (!stRef.current.session_id) beginSession(stRef.current);
    // Only once, when the screen opens.
  }, []);

  // A newer copy of the same version (fresh photo links) replaces the saved one. A changed recipe
  // replaces it only before cooking started; once started, cooking finishes on its copy.
  useEffect(() => {
    if (!fresh) return;
    const cur = stRef.current;
    if (fresh.version === cur.recipe_version) {
      if (fresh !== cur.recipe) save({ ...cur, recipe: fresh });
    } else if (!cur.started) {
      const ids = new Set(fresh.ingredients.map((i) => i.id));
      save({
        ...newCookState(fresh, readRecalc(fresh), guest),
        checked_ingredients: cur.checked_ingredients.filter((i) => ids.has(i)),
      });
    }
  }, [fresh]);

  // PRD 4.8: the furthest step reached also goes to the server, after a pause.
  useEffect(() => {
    if (phase !== 'step') return;
    reached.current = Math.max(reached.current, st.step_index);
    if (reached.current <= sent.current) return;
    const timer = setTimeout(() => {
      const sessionId = stRef.current.session_id;
      if (!sessionId) return;
      const n = Math.min(reached.current, 59);
      sent.current = n;
      patchCookSession(sessionId, { max_step_index: n, ...withToken }).catch(() => undefined);
    }, PROGRESS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [phase, st.step_index]);

  useWakeLock(phase === 'step', () => toast(t('cook.wake_lock')));
  const timers = useCookTimers({ active: phase === 'step', stRef, save, botStarted });

  const recipe = st.recipe;
  const uiLang: Lang = isLanguage(i18n.language) ? i18n.language : 'en';
  const langs: Langs = { recipeLang: recipeLangOf(recipe, uiLang), uiLang };
  const updated = !!fresh && fresh.version !== st.recipe_version;
  const total = recipe.steps.length;

  const restart = (r: Recipe) => {
    finished.current = false;
    reached.current = 0;
    sent.current = 0;
    save(newCookState(r, readRecalc(r), guest));
    setPhase('prep');
  };

  const go = (index: number) => {
    const next = Math.max(0, Math.min(index, lastIndex(recipe)));
    if (next === stRef.current.step_index) return;
    haptic('select');
    save({ ...stRef.current, step_index: next });
  };

  const finish = () => {
    const s = stRef.current;
    finished.current = true;
    // PRD 4.8: the progress and the recalculation are cleared once cooking is finished.
    clearCook(s.recipe_id);
    writeRecalc(s.recipe_id, null);
    if (s.session_id)
      patchCookSession(s.session_id, { state: 'finished', ...withToken }).catch(() => undefined);
    haptic('success');
    setPhase('done');
  };

  const toRecipe = () =>
    navigate(guest ? `/r/${encodeURIComponent(guest)}` : `/recipe/${recipe.id}`, { replace: true });

  if (total === 0) return <EmptyState icon={'🍽️'} title={t('cook.no_steps')} />;

  if (phase === 'resume') {
    return (
      <div className="stack">
        <h1 lang={recipe.language ?? undefined}>{t('cook.title', { title: recipe.title })}</h1>
        <section className="notice stack stack--tight" aria-label={t('cook.resume_label')}>
          <p>{t('cook.resume', { n: st.step_index + 1, total })}</p>
          <div className="row">
            <Button className="grow" onClick={() => setPhase('step')}>
              {t('cook.resume_continue')}
            </Button>
            <Button
              className="grow"
              variant="secondary"
              onClick={() => {
                const old = stRef.current;
                if (old.session_id) {
                  patchCookSession(old.session_id, { state: 'abandoned', ...withToken }).catch(
                    () => undefined,
                  );
                }
                restart(fresh ?? old.recipe);
              }}
            >
              {t('cook.resume_restart')}
            </Button>
          </div>
        </section>
      </div>
    );
  }

  if (phase === 'prep') {
    return (
      <Preparation
        st={st}
        langs={langs}
        onToggle={(ingredientId) => {
          const cur = stRef.current;
          const checked = cur.checked_ingredients.includes(ingredientId)
            ? cur.checked_ingredients.filter((x) => x !== ingredientId)
            : [...cur.checked_ingredients, ingredientId];
          save({ ...cur, checked_ingredients: checked });
        }}
        onStart={() => {
          const cur = stRef.current;
          const s: CookState = {
            ...cur,
            started: true,
            step_index: 0,
            session_id: null,
            // The recalculation chosen on the card at this moment is the one cooking keeps.
            scale: scaleFromRecalc(readRecalc(cur.recipe)),
          };
          save(s);
          setPhase('step');
          beginSession(s);
        }}
      />
    );
  }

  if (phase === 'done') {
    const session = st.session_id ? `?session=${encodeURIComponent(st.session_id)}` : '';
    return (
      <div className="stack center">
        <p className="cook__done" aria-hidden="true">
          {'🎉'}
        </p>
        <h1>{t('cook.done_title')}</h1>
        <p>{t('cook.enjoy')}</p>
        {updated && <p className="notice">{t('cook.recipe_updated')}</p>}
        <Button block onClick={toRecipe}>
          {t('cook.back_to_recipe')}
        </Button>
        <Button block variant="secondary" onClick={() => restart(fresh ?? recipe)}>
          {t('cook.again')}
        </Button>
        {/* FE-10: "I cooked it", tied to this cooking session. "My version" stays hidden.
            A guest with only the link may not react (owner's Sprint 6 answer 2). */}
        {!guest && (
          <Button
            block
            variant="ghost"
            onClick={() => navigate(`/recipe/${recipe.id}/cooked${session}`)}
          >
            {t('cook.cooked')}
          </Button>
        )}
      </div>
    );
  }

  const steps = sortedSteps(recipe);
  const index = Math.min(st.step_index, steps.length - 1);
  return (
    <StepView
      key={steps[index]!.id}
      recipe={recipe}
      step={steps[index]!}
      index={index}
      total={steps.length}
      k={st.scale?.k ?? 1}
      langs={langs}
      onPrev={() => go(index - 1)}
      onNext={() => go(index + 1)}
      onFinish={finish}
      onExit={toRecipe}
      timers={timers}
    />
  );
}

/** PRD 2.4 step 3: the whole recalculated list, "do I have everything?". */
function Preparation({
  st,
  langs,
  onToggle,
  onStart,
}: {
  st: CookState;
  langs: Langs;
  onToggle: (ingredientId: string) => void;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  const r = st.recipe;
  const recalc = readRecalc(r);
  const k = recalc?.k ?? 1;
  const lang = r.language ?? undefined;
  const checked = new Set(st.checked_ingredients);
  return (
    <div className="stack">
      <h1 lang={lang}>{t('cook.title', { title: r.title })}</h1>
      <section className="section stack stack--tight" aria-labelledby="cook-prep-h">
        <div className="row row--between">
          <h2 id="cook-prep-h">{t('cook.prep_title')}</h2>
          <span className="hint">
            {recalc
              ? t('recalc.servings_now', { value: servingsText(r.servings * k, langs.uiLang) })
              : t('recipe.servings', { count: r.servings })}
          </span>
        </div>
        <p className="hint">{t('cook.prep_hint')}</p>
        {groupIngredients(r.ingredients).map((g, i) => (
          <div key={`${g.label ?? ''}-${i}`} className="stack stack--tight" lang={lang}>
            {g.label && <h3 className="ing-group">{g.label}</h3>}
            <ul className="ings">
              {g.items.map((ing) => {
                const amount = amountText(ing, langs, 1, k);
                return (
                  <li key={ing.id} className="ing">
                    <label className="row grow cook__check">
                      <input
                        type="checkbox"
                        checked={checked.has(ing.id)}
                        onChange={() => onToggle(ing.id)}
                      />
                      <span className="grow">
                        {ing.qty_kind === 'unparsed' ? (ing.raw_line ?? ing.name) : ing.name}
                      </span>
                      {amount && <span className="ing__amount">{amount}</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
      <div className="actionbar">
        <Button block onClick={onStart}>
          {t('cook.start')}
        </Button>
      </div>
    </div>
  );
}

/** PRD 2.4 steps 5-6: one step, large text, its ingredients (recalculated), photo, video, timers. */
function StepView({
  recipe,
  step,
  index,
  total,
  k,
  langs,
  onPrev,
  onNext,
  onFinish,
  onExit,
  timers,
}: {
  recipe: Recipe;
  step: Step;
  index: number;
  total: number;
  k: number;
  langs: Langs;
  onPrev: () => void;
  onNext: () => void;
  onFinish: () => void;
  onExit: () => void;
  timers: CookTimers;
}) {
  const { t } = useTranslation();
  const [video, setVideo] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const lang = recipe.language ?? undefined;
  const byId = new Map(recipe.ingredients.map((i) => [i.id, i]));
  const stepVideo = step.video_id ? recipe.videos.find((v) => v.id === step.video_id) : undefined;
  const recalculated = Math.abs(k - 1) > 1e-9;
  const last = index === total - 1;
  const sectioned = new Set(recipe.ingredients.map((i) => i.group_label)).size > 1;

  // Left = next, right = previous; buttons too (Telegram Desktop has no gestures). The last step
  // is finished only with the button, never by an accidental swipe.
  const onTouchStart = (e: TouchEvent) => {
    const p = e.touches[0];
    touch.current = p ? { x: p.clientX, y: p.clientY } : null;
  };
  const onTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const from = touch.current;
    const to = e.changedTouches[0];
    touch.current = null;
    if (!from || !to) return;
    const dx = to.clientX - from.x;
    const dy = to.clientY - from.y;
    const min = Math.max(SWIPE_MIN_PX, e.currentTarget.clientWidth / 4);
    if (Math.abs(dx) < min || Math.abs(dx) <= Math.abs(dy)) return;
    if (dx > 0) onPrev();
    else if (!last) onNext();
  };

  return (
    <div className="stack cook">
      <TimerAlarm timers={timers} />
      <div className="row row--between">
        <span className="label">{t('cook.step_of', { n: index + 1, total })}</span>
        <Button variant="ghost" onClick={onExit}>
          {t('cook.exit')}
        </Button>
      </div>
      <div className="cook__progress" aria-hidden="true">
        <span style={{ width: `${((index + 1) / total) * 100}%` }} />
      </div>
      <Tip id="timers" />
      <div
        className="cook__swipe stack"
        data-swipe-zone
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {step.title && (
          <h2 lang={lang} className="cook__title">
            {step.title}
          </h2>
        )}
        {step.photo && !photoFailed && (
          <img
            className="step__photo"
            src={step.photo.url}
            srcSet={photoSrcSet(step.photo)}
            sizes="100vw"
            width={step.photo.width}
            height={step.photo.height}
            alt={t('recipe.step_photo', { n: index + 1 })}
            decoding="async"
            // A copy saved long ago may hold an expired photo link: hide it rather than break.
            onError={() => setPhotoFailed(true)}
          />
        )}
        {step.ingredients.length > 0 && (
          <ul className="ings" lang={lang} aria-label={t('recipe.step_ingredients')}>
            {step.ingredients.map((link) => {
              const ing = byId.get(link.ingredient_id);
              if (!ing) return null;
              const amount = amountText(ing, langs, link.portion_fraction, k);
              return (
                <li key={link.ingredient_id} className="ing">
                  <span className="grow">
                    {ing.name}
                    {sectioned && ing.group_label && (
                      <span className="hint">
                        {' · '}
                        {ing.group_label}
                      </span>
                    )}
                  </span>
                  {amount && <span className="ing__amount">{amount}</span>}
                </li>
              );
            })}
          </ul>
        )}
        {step.body && (
          <p className="cook__text" lang={lang}>
            {stepBodyParts(step.body, byId).map((part, i) => {
              if (part.kind === 'text') return part.text;
              const ing = part.ingredient;
              const share = step.ingredients.find((l) => l.ingredient_id === ing.id);
              return (
                <strong key={i} title={ing.name}>
                  {amountText(ing, langs, share?.portion_fraction ?? 1, k) ??
                    ing.raw_line ??
                    ing.name}
                </strong>
              );
            })}
          </p>
        )}
        <TimerButtons step={step} timers={timers} lang={lang} recalculated={recalculated} />
        {stepVideo &&
          (video ? (
            <VideoPlayer video={stepVideo} startSec={step.video_start_sec} />
          ) : (
            <Button variant="secondary" onClick={() => setVideo(true)}>
              {t('cook.video_at_step')}
            </Button>
          ))}
        <p className="hint">{t('cook.swipe_hint')}</p>
      </div>
      <TimersPanel timers={timers} />
      <WriteAccessSheet timers={timers} />
      <div className="actionbar row">
        <Button
          variant="secondary"
          className="grow cook__nav"
          disabled={index === 0}
          onClick={onPrev}
        >
          {t('cook.prev')}
        </Button>
        <Button className="grow cook__nav" onClick={last ? onFinish : onNext}>
          {last ? t('cook.finish') : t('cook.next')}
        </Button>
      </div>
    </div>
  );
}
