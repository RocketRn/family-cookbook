import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import react from 'eslint-plugin-react';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  { files: ['**/*.{mjs,js}'], languageOptions: { globals: globals.node } },
  {
    files: ['apps/api/**/*.ts', 'apps/worker/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  { files: ['apps/web/**/*.{ts,tsx}'], languageOptions: { globals: globals.browser } },
  {
    // PRD 6.6 / 7.1: no hard-coded user-visible strings. Text must come from i18n (t(...)).
    // Only pure symbols/emoji used as icons are allowed as literals.
    files: ['apps/web/src/**/*.tsx'],
    plugins: { react },
    rules: {
      'react/jsx-no-literals': [
        'error',
        {
          noStrings: true,
          allowedStrings: [
            '✕',
            '‹',
            '·',
            '(',
            ')',
            ':',
            '+',
            '＋',
            '−',
            '⋮⋮',
            '🔖',
            '📖',
            '👤',
            '🔍',
            '🍽️',
            '🔗',
            '✈️',
            '⚠️',
            '⏱',
            '▶',
            '↑',
            '↓',
            '🔒',
          ],
          ignoreProps: true,
        },
      ],
    },
  },
  prettier,
);
