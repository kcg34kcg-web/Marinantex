import prettier from 'eslint-config-prettier';

/** @type {import('eslint').Linter.Config[]} */
const config = [
  {
    ignores: ['node_modules/**', '.next/**', 'out/**', 'coverage/**', 'backend/**', 'dist/**', 'package-lock.json'],
  },
  prettier,
];

export default config;
