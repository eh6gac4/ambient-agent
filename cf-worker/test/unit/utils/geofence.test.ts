import { describe, it, expect } from "vitest";
import { haversineMeters, isInside, detectTransition } from "../../../src/utils/geofence.js";

describe("haversineMeters", () => {
  it("同じ座標は 0m を返す", () => {
    expect(haversineMeters(35.6812, 139.7671, 35.6812, 139.7671)).toBe(0);
  });

  it("東京〜大阪は約 400km", () => {
    const dist = haversineMeters(35.6812, 139.7671, 34.6937, 135.5023);
    expect(dist).toBeGreaterThan(390_000);
    expect(dist).toBeLessThan(410_000);
  });

  it("100m 程度の近距離を概ね正確に計算する", () => {
    // 約 0.001 度 ≈ 111m
    const dist = haversineMeters(35.6812, 139.7671, 35.6822, 139.7671);
    expect(dist).toBeGreaterThan(100);
    expect(dist).toBeLessThan(130);
  });
});

describe("isInside", () => {
  it("距離が半径以内なら true", () => {
    expect(isInside(100, 150)).toBe(true);
  });

  it("距離が半径と等しいなら true（境界値）", () => {
    expect(isInside(150, 150)).toBe(true);
  });

  it("距離が半径を超えたら false", () => {
    expect(isInside(151, 150)).toBe(false);
  });
});

describe("detectTransition", () => {
  it("null → inside は enter", () => {
    expect(detectTransition(null, "inside")).toBe("enter");
  });

  it("outside → inside は enter", () => {
    expect(detectTransition("outside", "inside")).toBe("enter");
  });

  it("inside → outside は leave", () => {
    expect(detectTransition("inside", "outside")).toBe("leave");
  });

  it("null → outside は null（初回圏外は遷移なし）", () => {
    expect(detectTransition(null, "outside")).toBe(null);
  });

  it("inside → inside は null（変化なし）", () => {
    expect(detectTransition("inside", "inside")).toBe(null);
  });

  it("outside → outside は null（変化なし）", () => {
    expect(detectTransition("outside", "outside")).toBe(null);
  });
});
