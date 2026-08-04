import { describe, it, expect, vi, beforeEach } from "vitest";
import { deliverMorningAiNews } from "../../../src/handlers/ai-news.js";
import { createMockEnv } from "../../helpers/mocks.js";

vi.mock("../../../src/clients/gemini.js", () => ({
  searchAiNews: vi.fn(),
}));

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

  it("sends the searched news content to Telegram", async () => {
    const env = createMockEnv();
    const { searchAiNews } = await import("../../../src/clients/gemini.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (searchAiNews as ReturnType<typeof vi.fn>).mockResolvedValue("今日のAIニュースやで〜");

    await deliverMorningAiNews(env);

    expect(sendMessage).toHaveBeenCalledWith(env, "今日のAIニュースやで〜");
  });

  it("sends a fallback error message when the search fails", async () => {
    const env = createMockEnv();
    const { searchAiNews } = await import("../../../src/clients/gemini.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (searchAiNews as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Gemini API failed"));

    await deliverMorningAiNews(env);

    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("エラー起きたみたいや"));
  });
});
