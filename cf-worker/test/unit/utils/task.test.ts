import { describe, it, expect } from "vitest";
import { PRIORITY_ORDER, PRIORITY_ICON, bestPriorityTask } from "../../../src/utils/task.js";

describe("task utils", () => {
  it("PRIORITY_ORDER ranks high < medium < low", () => {
    expect(PRIORITY_ORDER.high).toBe(0);
    expect(PRIORITY_ORDER.medium).toBe(1);
    expect(PRIORITY_ORDER.low).toBe(2);
  });

  it("PRIORITY_ICON maps each priority", () => {
    expect(PRIORITY_ICON.high).toBe("🔴");
    expect(PRIORITY_ICON.medium).toBe("🟡");
    expect(PRIORITY_ICON.low).toBe("🟢");
  });

  it("bestPriorityTask picks the highest priority", () => {
    const tasks = [
      { priority: "low", id: 1 },
      { priority: "high", id: 2 },
      { priority: "medium", id: 3 },
    ];
    expect(bestPriorityTask(tasks).id).toBe(2);
  });

  it("bestPriorityTask returns the first on ties (<=)", () => {
    const tasks = [
      { priority: "medium", id: 1 },
      { priority: "medium", id: 2 },
    ];
    expect(bestPriorityTask(tasks).id).toBe(1);
  });

  it("bestPriorityTask treats unknown priority as medium", () => {
    const tasks = [
      { priority: "weird", id: 1 },
      { priority: "low", id: 2 },
    ];
    // unknown(1) <= low(2) → keeps the unknown one
    expect(bestPriorityTask(tasks).id).toBe(1);
  });
});
