import type { Lang } from '@cookbook/recipe-core';
import { useTranslation } from 'react-i18next';
import type { Ingredient } from '../api/types';
import { amountText, groupIngredients } from './amounts';

type Langs = { recipeLang: Lang; uiLang: Lang };

function Line({ ing, langs }: { ing: Ingredient; langs: Langs }) {
  const { t } = useTranslation();
  const amount = amountText(ing, langs);
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

/** Ingredients as written (k = 1), grouped by section (PRD 5.1), formatted by recipe-core. */
export function IngredientList({
  ingredients,
  servings,
  langs,
  lang,
}: {
  ingredients: Ingredient[];
  servings: number;
  langs: Langs;
  lang: string | undefined;
}) {
  const { t } = useTranslation();
  return (
    <section className="section stack stack--tight" aria-labelledby="ings-h">
      <div className="row row--between">
        <h2 id="ings-h">{t('recipe.ingredients')}</h2>
        <span className="hint">{t('recipe.servings', { count: servings })}</span>
      </div>
      {groupIngredients(ingredients).map((g, i) => (
        <div key={`${g.label ?? ''}-${i}`} className="stack stack--tight" lang={lang}>
          {g.label && <h3 className="ing-group">{g.label}</h3>}
          <ul className="ings">
            {g.items.map((ing) => (
              <Line key={ing.id} ing={ing} langs={langs} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
