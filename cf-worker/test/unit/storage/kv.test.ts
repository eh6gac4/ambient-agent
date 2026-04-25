import { describe, it, expect } from "vitest";
import {
  getTelegramOffset,
  setTelegramOffset,
  getTaskCache,
  setTaskCache,
  getNoTaskSenders,
  addNoTaskSender,
  removeNoTaskSender,
  recordUsage,
  getDailyUsage,
} from "../../../src/storage/kv.js";
import { createMockEnv, sampleTasks } from "../../helpers/mocks.js";

describe("telegram offset", () => {
  it("returns 0 when not set", async () => {
    const env = createMockEnv();
    expect(await getTelegramOffset(env)).toBe(0);
  });

  it("persists and retrieves offset", async () => {
    const env = createMockEnv();
    await setTelegramOffset(env, 12345);
    expect(await getTelegramOffset(env)).toBe(12345);
  });
});

describe("task cache", () => {
  it("returns empty array when not set", async () => {
    const env = createMockEnv();
    expect(await getTaskCache(env)).toEqual([]);
  });

  it("persists and retrieves task list", async () => {
    const env = createMockEnv();
    const tasks = sampleTasks();
    await setTaskCache(env, tasks);
    const result = await getTaskCache(env);
    expect(result).toHaveLength(3);
    expect(result[0].pageId).toBe("page-001");
  });
});

describe("no-task senders blocklist", () => {
  it("returns empty set when not set", async () => {
    const env = createMockEnv();
    const senders = await getNoTaskSenders(env);
    expect(senders.size).toBe(0);
  });

  it("adds sender to blocklist", async () => {
    const env = createMockEnv();
    await addNoTaskSender(env, "spam@example.com");
    const senders = await getNoTaskSenders(env);
    expect(senders.has("spam@example.com")).toBe(true);
  });

  it("normalizes email to lowercase when adding", async () => {
    const env = createMockEnv();
    await addNoTaskSender(env, "SPAM@EXAMPLE.COM");
    const senders = await getNoTaskSenders(env);
    expect(senders.has("spam@example.com")).toBe(true);
  });

  it("removes existing sender and returns true", async () => {
    const env = createMockEnv();
    await addNoTaskSender(env, "spam@example.com");
    const result = await removeNoTaskSender(env, "spam@example.com");
    expect(result).toBe(true);
    const senders = await getNoTaskSenders(env);
    expect(senders.has("spam@example.com")).toBe(false);
  });

  it("returns false when sender not in blocklist", async () => {
    const env = createMockEnv();
    const result = await removeNoTaskSender(env, "unknown@example.com");
    expect(result).toBe(false);
  });
});

describe("usage tracking", () => {
  it("records usage entries", async () => {
    const env = createMockEnv();
    const today = new Date().toISOString().slice(0, 10);
    await recordUsage(env, "gmail_check", 100, 50);
    await recordUsage(env, "analyze_email", 200, 80);

    const entries = await getDailyUsage(env, today);
    expect(entries).toHaveLength(2);
    expect(entries[0].job).toBe("gmail_check");
    expect(entries[0].inputTokens).toBe(100);
    expect(entries[1].job).toBe("analyze_email");
  });

  it("returns empty array for date with no usage", async () => {
    const env = createMockEnv();
    const entries = await getDailyUsage(env, "2020-01-01");
    expect(entries).toEqual([]);
  });
});
