import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // noUncheckedIndexedAccess makes every typed-array read optional; in tight
      // numeric loops a bounds-checked `!` is clearer than a fallback value.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['packages/web/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  prettier,
);
