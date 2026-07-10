import { describe, it, expect } from "vitest";
import { shouldSendBriefing, filterTasksForLocation } from "../../../src/utils/notification-policy.js";
import type { Task } from "../../../src/types.js";

describe("shouldSendBriefing", () => {
  // デフォルト: 22:00〜07:00 が静穏時間 (送信スキップ -> false)
  it("returns true during daytime with default config", () => {
    const daytime = new Date("2026-07-10T12:00:00");
    expect(shouldSendBriefing(daytime)).toBe(true);
  });

  it("returns false during quiet hours with default config (late night)", () => {
    const lateNight = new Date("2026-07-10T23:30:00");
    expect(shouldSendBriefing(lateNight)).toBe(false);
  });

  it("returns false during quiet hours with default config (early morning)", () => {
    const earlyMorning = new Date("2026-07-10T05:00:00");
    expect(shouldSendBriefing(earlyMorning)).toBe(false);
  });

  it("handles boundary values with default config", () => {
    const exactly22 = new Date("2026-07-10T22:00:00");
    const exactly07 = new Date("2026-07-10T07:00:00");
    const exactly2159 = new Date("2026-07-10T21:59:59");
    const exactly0659 = new Date("2026-07-10T06:59:59");

    expect(shouldSendBriefing(exactly22)).toBe(false);
    expect(shouldSendBriefing(exactly07)).toBe(true);
    expect(shouldSendBriefing(exactly2159)).toBe(true);
    expect(shouldSendBriefing(exactly0659)).toBe(false);
  });

  // カスタム設定
  it("respects custom quiet hours (non-crossing, e.g. 9 to 17)", () => {
    const config = { quietHoursStart: 9, quietHoursEnd: 17 };
    const morning = new Date("2026-07-10T08:00:00");
    const afternoon = new Date("2026-07-10T12:00:00");
    const evening = new Date("2026-07-10T18:00:00");

    expect(shouldSendBriefing(morning, config)).toBe(true);
    expect(shouldSendBriefing(afternoon, config)).toBe(false);
    expect(shouldSendBriefing(evening, config)).toBe(true);
  });

  it("respects custom quiet hours (crossing, e.g. 0 to 6)", () => {
    const config = { quietHoursStart: 0, quietHoursEnd: 6 };
    const earlyMorning = new Date("2026-07-10T03:00:00");
    const morning = new Date("2026-07-10T07:00:00");

    expect(shouldSendBriefing(earlyMorning, config)).toBe(false);
    expect(shouldSendBriefing(morning, config)).toBe(true);
  });

  it("returns true always when quietHoursStart equals quietHoursEnd", () => {
    const config = { quietHoursStart: 8, quietHoursEnd: 8 };
    const date1 = new Date("2026-07-10T08:00:00");
    const date2 = new Date("2026-07-10T12:00:00");

    expect(shouldSendBriefing(date1, config)).toBe(true);
    expect(shouldSendBriefing(date2, config)).toBe(true);
  });
});

describe("filterTasksForLocation", () => {
  const mockTasks: Task[] = [
    {
      title: "Task Home 1",
      due: null,
      priority: "high",
      status: "Todo",
      location: "home",
      lastEdited: null,
      url: "http://example.com/1",
      pageId: "1",
    },
    {
      title: "Task Office 1",
      due: null,
      priority: "medium",
      status: "Todo",
      location: "office",
      lastEdited: null,
      url: "http://example.com/2",
      pageId: "2",
    },
    {
      title: "Task Home 2 (Kanji)",
      due: null,
      priority: "low",
      status: "Todo",
      location: "自宅",
      lastEdited: null,
      url: "http://example.com/3",
      pageId: "3",
    },
    {
      title: "Task Office 2 (Kanji)",
      due: null,
      priority: "high",
      status: "Todo",
      location: "会社",
      lastEdited: null,
      url: "http://example.com/4",
      pageId: "4",
    },
    {
      title: "Task Gym",
      due: null,
      priority: "low",
      status: "Todo",
      location: "gym",
      lastEdited: null,
      url: "http://example.com/5",
      pageId: "5",
    },
    {
      title: "Task No Location",
      due: null,
      priority: "medium",
      status: "Todo",
      location: null,
      lastEdited: null,
      url: "http://example.com/6",
      pageId: "6",
    },
  ];

  it("filters tasks related to 'home'", () => {
    const homeTasks = filterTasksForLocation(mockTasks, "home");
    expect(homeTasks).toHaveLength(2);
    expect(homeTasks.map((t) => t.title)).toContain("Task Home 1");
    expect(homeTasks.map((t) => t.title)).toContain("Task Home 2 (Kanji)");
  });

  it("filters tasks related to '自宅' (case-insensitive and alias)", () => {
    const homeTasks = filterTasksForLocation(mockTasks, "自宅");
    expect(homeTasks).toHaveLength(2);
  });

  it("filters tasks related to 'office'", () => {
    const officeTasks = filterTasksForLocation(mockTasks, "office");
    expect(officeTasks).toHaveLength(2);
    expect(officeTasks.map((t) => t.title)).toContain("Task Office 1");
    expect(officeTasks.map((t) => t.title)).toContain("Task Office 2 (Kanji)");
  });

  it("filters specific location that has no alias", () => {
    const gymTasks = filterTasksForLocation(mockTasks, "gym");
    expect(gymTasks).toHaveLength(1);
    expect(gymTasks[0].title).toBe("Task Gym");
  });

  it("returns empty array when location matches nothing", () => {
    const missingTasks = filterTasksForLocation(mockTasks, "nowhere");
    expect(missingTasks).toHaveLength(0);
  });
});
