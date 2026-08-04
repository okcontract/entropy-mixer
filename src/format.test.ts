import { describe, expect, test } from "bun:test";

import {
  bytesToBase64,
  bytesToHex,
  formatBytes,
  formatChainKeyBatch,
  formatKeyBatch,
} from "./format.ts";

describe("output formatting", () => {
  test("encodes bytes as lowercase hexadecimal", () => {
    expect(bytesToHex(Uint8Array.of(0, 1, 15, 16, 255))).toBe("00010f10ff");
  });

  test("encodes complete and padded Base64 groups", () => {
    expect(bytesToBase64(new Uint8Array())).toBe("");
    expect(bytesToBase64(new TextEncoder().encode("f"))).toBe("Zg==");
    expect(bytesToBase64(new TextEncoder().encode("fo"))).toBe("Zm8=");
    expect(bytesToBase64(new TextEncoder().encode("foo"))).toBe("Zm9v");
    expect(bytesToBase64(Uint8Array.of(0xff, 0xee, 0xdd))).toBe("/+7d");
  });

  test("selects the requested output encoding", () => {
    const bytes = Uint8Array.of(0x66, 0x6f, 0x6f);
    expect(formatBytes(bytes, "hex")).toBe("666f6f");
    expect(formatBytes(bytes, "base64")).toBe("Zm9v");
  });

  test("renders one independently copyable key per line", () => {
    const keys = Uint8Array.of(0, 1, 2, 3, 4, 5);
    expect(formatKeyBatch(keys, 2, "hex")).toBe("0001\n0203\n0405");
    expect(() => formatKeyBatch(keys, 4, "hex")).toThrow(RangeError);
  });

  test("separates chain private keys from their corresponding addresses", () => {
    expect(
      formatChainKeyBatch([
        { privateKey: "private-1", address: "address-1" },
        { privateKey: "private-2", address: "address-2" },
      ]),
    ).toEqual({
      privateKeys: "private-1\nprivate-2",
      addresses: "address-1\naddress-2",
    });
  });
});
