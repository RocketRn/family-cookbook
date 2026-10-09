import type { Lang } from '@cookbook/recipe-core';
import { useTranslation } from 'react-i18next';
import type { Ingredient, Step, Video } from '../api/types';
import { amountText, photoSrcSet, splitDuration, stepBodyParts } from './amounts';
import { VideoPlayer } from './VideoPlayer';

type Langs = { recipeLang: Lang; uiLang: Lang };

function Duration({ sec }: { sec: number }) {
  const { t } = useTranslation();
  const { h, m, s } = splitDuration(sec);
  return (
    <>
      {[
        h > 0 ? t('time.h', { count: h }) : null,
        m > 0 ? t('time.min', { count: m }) : null,
        s > 0 ? t('time.s', { count: s }) : null,
      ]
        .filter(Boolean)
        .join(' ')}
    </>
  );
}

export function StepList({
  steps,
  ingredients,
  videos,
  langs,
  lang,
}: {
  steps: Step[];
  ingredients: Ingredient[];
  videos: Video[];
  langs: Langs;
  lang: string | undefined;
}) {
  const { t } = useTranslation();
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const videoById = new Map(videos.map((v) => [v.id, v]));
  // With several sections, a step's ingredient also names its section ("мука · для теста", PRD 5.1).
  const sectioned = new Set(ingredients.map((i) => i.group_label)).size > 1;

  return (
    <section className="stack stack--tight" aria-labelledby="steps-h">
      <h2 id="steps-h">{t('recipe.steps')}</h2>
      <ol className="steps">
        {[...steps]
          .sort((a, b) => a.position - b.position)
          .map((s, idx) => {
            const video = s.video_id ? videoById.get(s.video_id) : undefined;
            return (
              <li key={s.id} className="section stack stack--tight">
                <h3>
                  {t('recipe.step_n', { n: idx + 1 })}
                  {s.title && (
                    <span lang={lang}>
                      {' · '}
                      {s.title}
                    </span>
                  )}
                </h3>
                {s.photo && (
                  <img
                    className="step__photo"
                    src={s.photo.url}
                    srcSet={photoSrcSet(s.photo)}
                    sizes="100vw"
                    width={s.photo.width}
                    height={s.photo.height}
                    alt={t('recipe.step_photo', { n: idx + 1 })}
                    loading="lazy"
                    decoding="async"
                  />
                )}
                {s.ingredients.length > 0 && (
                  <ul className="ings" lang={lang} aria-label={t('recipe.step_ingredients')}>
                    {s.ingredients.map((link) => {
                      const ing = byId.get(link.ingredient_id);
                      if (!ing) return null;
                      const amount = amountText(ing, langs, link.portion_fraction);
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
                {s.body && (
                  <p className="step__body" lang={lang}>
                    {stepBodyParts(s.body, byId).map((part, i) => {
                      if (part.kind === 'text') return part.text;
                      // PRD 2.3: a placeholder stands for the ingredient's amount (this step's
                      // share when the step uses part of it), so it follows recalculation (D-029).
                      const ing = part.ingredient;
                      const share = s.ingredients.find((l) => l.ingredient_id === ing.id);
                      return (
                        <strong key={i} title={ing.name}>
                          {amountText(ing, langs, share?.portion_fraction ?? 1) ??
                            ing.raw_line ??
                            ing.name}
                        </strong>
                      );
                    })}
                  </p>
                )}
                {s.timers.length > 0 && (
                  <div className="row row--wrap">
                    {s.timers.map((tm) => (
                      <span key={tm.id} className="chip chip--static">
                        <span aria-hidden="true">{'⏱'}</span>
                        <span lang={lang}>{tm.label}</span>
                        <span>
                          {' · '}
                          <Duration sec={tm.duration_sec} />
                        </span>
                      </span>
                    ))}
                  </div>
                )}
                {video && <VideoPlayer video={video} startSec={s.video_start_sec} />}
              </li>
            );
          })}
      </ol>
    </section>
  );
}
