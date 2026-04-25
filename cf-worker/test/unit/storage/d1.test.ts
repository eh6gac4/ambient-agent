import { describe, it, expect } from "vitest";
import {
  getThreadMapEntry,
  setThreadMapEntry,
  getSenderForTask,
  setSenderForTask,
  deleteSenderMapEntry,
  getAllSenderMap,
  getCalendarSync,
  setCalendarSync,
  deleteCalendarSync,
  getAllCalendarSync,
  isProcessed,
  markProcessed,
  cleanOldProcessed,
} from "../../../src/storage/d1.js";
import { createMockEnv } from "../../helpers/mocks.js";

// These tests use the mock D1 which returns null/empty by default.
// The real behavior is tested via integration tests with miniflare.

describe("gmail_thread_map (mock D1)", () => {
  it("returns null for missing thread", async () => {
    const env = createMockEnv();
    expect(await getThreadMapEntry(env, "thread-nonexistent")).toBeNull();
  });
});

describe("task_sender_map (mock D1)", () => {
  it("returns null for missing pageId", async () => {
    const env = createMockEnv();
    expect(await getSenderForTask(env, "page-nonexistent")).toBeNull();
  });

  it("getAllSenderMap returns empty map when no entries", async () => {
    const env = createMockEnv();
    const map = await getAllSenderMap(env);
    expect(map.size).toBe(0);
  });
});

describe("calendar_sync (mock D1)", () => {
  it("returns null for missing pageId", async () => {
    const env = createMockEnv();
    expect(await getCalendarSync(env, "page-nonexistent")).toBeNull();
  });

  it("getAllCalendarSync returns empty map when no entries", async () => {
    const env = createMockEnv();
    const map = await getAllCalendarSync(env);
    expect(map.size).toBe(0);
  });
});

describe("processed_messages (mock D1)", () => {
  it("isProcessed returns false for unknown message", async () => {
    const env = createMockEnv();
    expect(await isProcessed(env, "msg-unknown")).toBe(false);
  });
});
