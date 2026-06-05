import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/*.gen.ts', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node } } },
  {
    // core stays framework-independent: it may import @closer/contracts only.
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'fastify',
                '@fastify/*',
                'react',
                'react-dom',
                'drizzle-orm',
                'drizzle-orm/*',
                'pg',
                '@closer/server',
                '@closer/web',
              ],
              message:
                'packages/core must stay framework-independent; import @closer/contracts only.',
            },
          ],
        },
      ],
    },
  },
)
