import { parseNumber, unitLabel, type Lang } from '@cookbook/recipe-core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Recipe } from '../api/types';
import { BottomSheet } from '../design/BottomSheet';
import { Button } from '../design/Button';
import { Chip } from '../design/Chip';
import { TextField } from '../design/Fields';
import { numberInput } from '../editor/model';
import { amountText } from './amounts';
import {
  computeRecalc,
  scalableIngredients,
  unitOptions,
  type RecalcInput,
  type RecalcState,
} from './recalc';

type Langs = { recipeLang: Lang; uiLang: Lang };

/** Servings as a person reads them: 4, or ≈ 2.5 after a recalculation from a product. */
export function servingsText(value: number, lang: Lang): string {
  const rounded = Math.round(value * 10) / 10;
  const text = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(rounded);
  return Math.abs(rounded - value) > 1e-9 || !Number.isInteger(rounded) ? `≈ ${text}` : text;
}

/**
 * FE-07 (PRD 5.2): recalculate by servings or from the amount of one product the user has. Shows
 * the PRD warnings (big change below ¼ or above 4) and refusals (past 1/20 or 20) before applying.
 */
export function RecalcSheet({
  recipe,
  current,
  langs,
  onApply,
  onReset,
  onClose,
}: {
  recipe: Recipe;
  current: RecalcState | null;
  langs: Langs;
  onApply: (state: RecalcState) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const lang = langs.recipeLang;
  const products = scalableIngredients(recipe);
  const [mode, setMode] = useState<RecalcInput['mode']>(current?.mode ?? 'servings');
  const [servings, setServings] = useState(() =>
    current?.mode === 'servings'
      ? current.servings
      : Math.max(1, Math.round(recipe.servings * (current?.k ?? 1))),
  );
  const [ingId, setIngId] = useState(
    current?.mode === 'product' ? current.ingredientId : (products[0]?.id ?? null),
  );
  const ing = products.find((i) => i.id === ingId) ?? null;
  const [amount, setAmount] = useState(
    current?.mode === 'product' ? numberInput(current.amount, lang) : '',
  );
  const [unit, setUnit] = useState<string | null>(
    current?.mode === 'product' ? current.unit : (ing?.unit_code ?? null),
  );

  const typed = parseNumber(amount);
  const input: RecalcInput | null =
    mode === 'servings'
      ? { mode, servings }
      : ing && amount.trim()
        ? { mode, ingredientId: ing.id, amount: typed ?? Number.NaN, unit }
        : null;
  const result = input ? computeRecalc(recipe, input) : null;
  const unitName = (code: string | null) =>
    code ? (unitLabel(code, lang, typed ?? 1) ?? code) : t('editor.no_unit');

  return (
    <BottomSheet open title={t('recalc.title')} onClose={onClose}>
      <div className="stack">
        <div className="row row--wrap" role="group" aria-label={t('recalc.title')}>
          <Chip selected={mode === 'servings'} onToggle={() => setMode('servings')}>
            {t('recalc.mode_servings')}
          </Chip>
          <Chip
            selected={mode === 'product'}
            disabled={products.length === 0}
            onToggle={() => setMode('product')}
          >
            {t('recalc.mode_product')}
          </Chip>
        </div>

        {mode === 'servings' ? (
          <div className="row row--between">
            <div>
              <div>{t('recalc.servings')}</div>
              <div className="hint">
                {t('recalc.servings_was', { value: servingsText(recipe.servings, langs.uiLang) })}
              </div>
            </div>
            <div className="row stepper">
              <Button
                variant="secondary"
                aria-label={t('editor.fewer')}
                disabled={servings <= 1}
                onClick={() => setServings((n) => Math.max(1, n - 1))}
              >
                {'−'}
              </Button>
              <output aria-live="polite" aria-label={t('recalc.servings')}>
                {servings}
              </output>
              <Button
                variant="secondary"
                aria-label={t('editor.more')}
                disabled={servings >= 999}
                onClick={() => setServings((n) => Math.min(999, n + 1))}
              >
                {'+'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="stack stack--tight">
            <fieldset className="plain">
              <legend className="label">{t('recalc.product')}</legend>
              <div className="row row--wrap" lang={lang}>
                {products.map((p) => {
                  // PRD 2.3: the same product in two sections is two lines; the section tells them apart.
                  const twice = products.some(
                    (o) =>
                      o.id !== p.id && o.name.trim().toLowerCase() === p.name.trim().toLowerCase(),
                  );
                  const label = twice && p.group_label ? `${p.name} · ${p.group_label}` : p.name;
                  return (
                    <Chip
                      key={p.id}
                      selected={p.id === ingId}
                      onToggle={() => {
                        setIngId(p.id);
                        setUnit(p.unit_code);
                      }}
                    >
                      {label}
                    </Chip>
                  );
                })}
              </div>
            </fieldset>
            {ing && (
              <>
                <p className="hint">
                  {t('recalc.in_recipe', { amount: amountText(ing, langs) ?? '' })}
                </p>
                <TextField
                  label={t('recalc.have')}
                  value={amount}
                  inputMode="decimal"
                  maxLength={12}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <div className="row row--wrap" lang={lang}>
                  {unitOptions(ing).map((u) => (
                    <Chip key={u ?? '-'} selected={unit === u} onToggle={() => setUnit(u)}>
                      {unitName(u)}
                    </Chip>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {result?.ok && (
          <div className="stack stack--tight" aria-live="polite">
            {mode === 'product' && (
              <p>
                <strong>
                  {t('recalc.result', { value: servingsText(result.servings, langs.uiLang) })}
                </strong>
              </p>
            )}
            {result.warning && <p className="notice">{t('recalc.big_change')}</p>}
          </div>
        )}
        {result && !result.ok && (
          <p className="error-text" role="alert">
            {t(`recalc.err_${result.error}`)}
          </p>
        )}

        <Button
          disabled={!result?.ok}
          onClick={() => result?.ok && input && onApply({ ...input, v: 1, k: result.k })}
        >
          {t('recalc.apply')}
        </Button>
        {current && (
          <Button variant="ghost" onClick={onReset}>
            {t('recalc.reset')}
          </Button>
        )}
      </div>
    </BottomSheet>
  );
}
