import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["test/**/*.test.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          // Provide placeholder values for secrets in tests
          bindings: {
            ANTHROPIC_API_KEY: "test-anthropic-key",
            NOTION_TOKEN: "test-notion-token",
            NOTION_TASKS_DB_ID: "test-db-id",
            TELEGRAM_BOT_TOKEN: "test-bot-token",
            TELEGRAM_CHAT_ID: "test-chat-id",
            GOOGLE_CLIENT_ID: "test-client-id",
            GOOGLE_CLIENT_SECRET: "test-client-secret",
            GOOGLE_REFRESH_TOKEN: "test-refresh-token",
          },
        },
      },
    },
  },
});
