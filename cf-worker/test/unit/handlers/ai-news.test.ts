import { describe, it, expect, vi, beforeEach } from "vitest";
import { deliverMorningAiNews } from "../../../src/handlers/ai-news.js";
import { createMockEnv } from "../../helpers/mocks.js";

vi.mock("../../../src/clients/telegram.js", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    sendMessage: vi.fn().mockResolvedValue(undefined),
  };
});

describe("deliverMorningAiNews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the morning news URL to Telegram", async () => {
    const env = createMockEnv();
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    await deliverMorningAiNews(env);

    expect(sendMessage).toHaveBeenCalledWith(env, "https://asa-mobile.toshiki-cho-dev.workers.dev/");
  });
});
