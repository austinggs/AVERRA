import nextConfig from 'eslint-config-next';

const config = [
  ...nextConfig,
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'AVERRA_FULL_PLAN/**',
      'AVERRA_V7_AUDIT.md',
      'supabase/functions/**',
    ],
  },
];

export default config;
