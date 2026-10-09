import type { Lang } from '@cookbook/recipe-core';
import { useTranslation } from 'react-i18next';
import type { Ingredient } from '../api/types';
import { amountText, groupIngredients } from './amounts';

type Langs = { recipeLang: Lang; uiLang: Lang };

function Line({ ing, langs, k }: { ing: Ingredient; langs: Langs; k: number }) {
  const { t } = useTranslation();
  const amount = amountText(ing, langs, 1, k);
  return (
    <li className="ing">
      <span className="grow">
        {ing.qty_kind === 'unparsed' ? (ing.raw_line ?? ing.name) : ing.name}
        {ing.optional && <span className="hint"> ({t('recipe.optional')})</span>}
        {ing.note && <span className="hint"> · {ing.note}</span>}
      </span>
      {amount && <span className="ing__amount">{amount}</span>}
    </li>
  );
}

/**
 * Ingredients grouped by section (PRD 5.1), formatted by recipe-core: as written at k = 1, else
 * recalculated and rounded (FE-07). `servingsLabel` is what the header shows.
 */
export function IngredientList({
  ingredients,
  servingsLabel,
  langs,
  lang,
  k = 1,
}: {
  ingredients: Ingredient[];
  servingsLabel: string;
  langs: Langs;
  lang: string | undefined;
  k?: number;
}) {
  const { t } = useTranslation();
  return (
    <section className="section stack stack--tight" aria-labelledby="ings-h">
      <div className="row row--between">
        <h2 id="ings-h">{t('recipe.ingredients')}</h2>
        <span className="hint">{servingsLabel}</span>
      </div>
      {groupIngredients(ingredients).map((g, i) => (
        <div key={`${g.label ?? ''}-${i}`} className="stack stack--tight" lang={lang}>
          {g.label && <h3 className="ing-group">{g.label}</h3>}
          <ul className="ings">
            {g.items.map((ing) => (
              <Line key={ing.id} ing={ing} langs={langs} k={k} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
