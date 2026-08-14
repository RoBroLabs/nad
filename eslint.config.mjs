import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'output/playwright/**',
      'src/lib/db/migrations/**',
      'src/lib/modules/contracts/**/*.generated.ts',
      'test-results/**',
      'next-env.d.ts',
    ],
  },
];

export default eslintConfig;
