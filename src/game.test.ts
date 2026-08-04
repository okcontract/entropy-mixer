import { describe, expect, test } from "bun:test";

import {
  isPrimaryPointerActivation,
  TARGET_COUNT,
  TARGET_POSITIONS,
  targetPosition,
} from "./game.ts";

describe("target sequence", () => {
  test("contains the required 16 public positions inside the arena", () => {
    expect(TARGET_COUNT).toBe(16);
    expect(TARGET_POSITIONS).toHaveLength(TARGET_COUNT);
    for (const position of TARGET_POSITIONS) {
      expect(position.x).toBeGreaterThanOrEqual(0.12);
      expect(position.x).toBeLessThanOrEqual(0.88);
      expect(position.y).toBeGreaterThanOrEqual(0.12);
      expect(position.y).toBeLessThanOrEqual(0.88);
    }
  });

  test("keeps consecutive targets far enough apart to require movement", () => {
    for (let index = 1; index < TARGET_POSITIONS.length; index += 1) {
      const previous = targetPosition(index - 1);
      const current = targetPosition(index);
      expect(
        Math.hypot(current.x - previous.x, current.y - previous.y),
      ).toBeGreaterThan(0.3);
    }
  });

  test("rejects indexes outside the fixed sequence", () => {
    expect(() => targetPosition(-1)).toThrow(RangeError);
    expect(() => targetPosition(TARGET_COUNT)).toThrow(RangeError);
  });
});

describe("pointer input", () => {
  test("accepts primary mouse, pen, and touch contacts", () => {
    for (const pointerType of ["mouse", "pen", "touch"]) {
      expect(
        isPrimaryPointerActivation({ button: 0, isPrimary: true, pointerType }),
      ).toBe(true);
    }
  });

  test("ignores secondary buttons and additional touch contacts", () => {
    expect(
      isPrimaryPointerActivation({
        button: 2,
        isPrimary: true,
        pointerType: "mouse",
      }),
    ).toBe(false);
    expect(
      isPrimaryPointerActivation({
        button: 0,
        isPrimary: false,
        pointerType: "touch",
      }),
    ).toBe(false);
  });
});
