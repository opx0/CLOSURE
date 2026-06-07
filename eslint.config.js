import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/*.gen.ts', 'node_modules/**', '.claude/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node } } },
  {
    // core stays framework-independent: it may import @closer/contracts and @closer/prompts
    // (both are plain domain packages) and nothing that carries a framework or a driver.
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
                'packages/core must stay framework-independent; import @closer/contracts or @closer/prompts.',
            },
          ],
        },
      ],
    },
  },
)
