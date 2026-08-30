import { defineConfig, devices } from "@playwright/test";

const webPort = 3100;
const apiPort = 3101;
const webOrigin = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: webOrigin,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      name: "api",
      command: "npm run dev:api",
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        ...process.env,
        AUTH_ENABLED: "false",
        LANGGRAPH_CHECKPOINTER: "memory",
        ASSISTANT_LOG_LEVEL: "off",
        NEST_API_PORT: String(apiPort),
        API_HOST: "127.0.0.1",
        WEB_ORIGIN: webOrigin,
      },
    },
    {
      name: "web",
      command: `npm run dev:web -- --hostname 127.0.0.1 --port ${webPort}`,
      url: webOrigin,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        ...process.env,
        NEXT_PUBLIC_AUTH_ENABLED: "false",
        NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
        NEXT_DIST_DIR: ".next-e2e",
      },
    },
  ],
});
