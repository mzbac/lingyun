// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/', 'node_modules/', '*.js', '!eslint.config.js'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always'],
    },
  },
  {
    files: ['src/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: [
      'src/core/agent/index.ts',
      'src/core/utils/normalizeResponsesStream.ts',
      'src/providers/copilot.ts',
      'src/providers/codexSubscription.ts',
      'src/ui/chat/methods.approvals.ts',
      'src/ui/chat/methods.runner.callbacks.ts',
      'src/ui/chat/methods.sessions.persistence.ts',
      'src/ui/chat/methods.sessions.runtime.ts',
      'src/ui/chat/methods.webview.ts',
      'src/ui/chat/runner/callbackUtils.ts',
      'src/ui/chat/runner/runCoordinator.ts',
      'src/ui/chat/utils.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
