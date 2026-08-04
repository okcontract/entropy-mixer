import { describe, expect, test } from "bun:test";

import { allowConfirmedCopy, bindCopyControls } from "./copy.ts";

const copyControls = () => ({
  private: {
    button: new EventTarget(),
    output: Object.assign(new EventTarget(), { value: "secret" }),
    feedback: "private",
  },
  bitcoin: {
    button: new EventTarget(),
    output: Object.assign(new EventTarget(), { value: "bitcoin-address" }),
    feedback: "bitcoin",
  },
  ethereum: {
    button: new EventTarget(),
    output: Object.assign(new EventTarget(), { value: "ethereum-address" }),
    feedback: "ethereum",
  },
});

describe("private output copy guard", () => {
  test("allows a confirmed native copy", () => {
    const event = new Event("copy", { cancelable: true });

    expect(allowConfirmedCopy(event, () => true)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  test("cancels a rejected native copy", () => {
    const event = new Event("copy", { cancelable: true });

    expect(allowConfirmedCopy(event, () => false)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  test("guards both native and button copies", () => {
    const controls = copyControls();
    const copied: Array<[string, string, boolean | undefined]> = [];
    const cancelled: string[] = [];
    let confirmed = false;

    bindCopyControls(controls, {
      confirmPrivateCopy: () => confirmed,
      copy: (output, feedback, privateCopyConfirmed) => {
        copied.push([output.value, feedback, privateCopyConfirmed]);
      },
      isPrivateCopyApproved: () => false,
      privateCopyCancelled: (feedback) => cancelled.push(feedback),
    });

    const rejectedNativeCopy = new Event("copy", { cancelable: true });
    controls.private.output.dispatchEvent(rejectedNativeCopy);
    controls.private.button.dispatchEvent(new Event("click"));
    expect(rejectedNativeCopy.defaultPrevented).toBe(true);
    expect(cancelled).toEqual(["private", "private"]);
    expect(copied).toEqual([]);

    confirmed = true;
    const confirmedNativeCopy = new Event("copy", { cancelable: true });
    controls.private.output.dispatchEvent(confirmedNativeCopy);
    controls.private.button.dispatchEvent(new Event("click"));
    expect(confirmedNativeCopy.defaultPrevented).toBe(false);
    expect(copied).toEqual([["secret", "private", true]]);
  });

  test("routes each public copy button to its own address output", () => {
    const controls = copyControls();
    const copied: Array<[string, string, boolean | undefined]> = [];

    bindCopyControls(controls, {
      confirmPrivateCopy: () => true,
      copy: (output, feedback, privateCopyConfirmed) => {
        copied.push([output.value, feedback, privateCopyConfirmed]);
      },
      isPrivateCopyApproved: () => false,
      privateCopyCancelled: () => undefined,
    });

    controls.bitcoin.button.dispatchEvent(new Event("click"));
    controls.ethereum.button.dispatchEvent(new Event("click"));

    expect(copied).toEqual([
      ["bitcoin-address", "bitcoin", undefined],
      ["ethereum-address", "ethereum", undefined],
    ]);
  });
});
