import { defineConfig, devices } from '@playwright/test'

const PORT = 3097

// `*.e2e.ts`, not `*.spec.ts`: Bun's test runner claims `.spec.ts` by default, and a Playwright
// file picked up by `bun test` fails in a way that looks like a broken product rather than a
// misrouted file.
export default defineConfig({
  testDir: './apps/web/e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI === 'true' ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
        permissions: ['microphone'],
      },
    },
  ],
  webServer: {
    // The built client, served by the real API. Building here rather than assuming a `dist/`
    // means the journey can never pass against a stale bundle.
    command: `bun run web:build && PORT=${PORT} bun run apps/server/src/testing/e2e-server.ts`,
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
