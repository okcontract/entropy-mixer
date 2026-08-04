import { describe, expect, test } from "bun:test";

import { resetOnPageHide } from "./lifecycle.ts";

describe("page lifecycle", () => {
  test("resets the session whenever the page is hidden", () => {
    const target = new EventTarget();
    let resets = 0;
    resetOnPageHide(target, () => {
      resets += 1;
    });

    expect(resets).toBe(0);
    target.dispatchEvent(new Event("pagehide"));
    target.dispatchEvent(new Event("pagehide"));
    expect(resets).toBe(2);
  });
});
