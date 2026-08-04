import { describe, expect, test } from "bun:test";

import {
  type ClickSample,
  encodeClickTranscript,
  HmacSha256Generator,
  makeHybridSeed,
  pointerTypeCode,
  quantizeMicroseconds,
  quantizeSignedFixed256,
  quantizeUnsignedFixed256,
  TRANSCRIPT_HEADER_BYTES,
  TRANSCRIPT_SAMPLE_BYTES,
} from "./entropy.ts";
import { bytesToHex } from "./format.ts";

const sample: ClickSample = {
  targetNumber: 0x1234,
  reactionTimeMicroseconds: 0x0102_0304,
  targetCenterX256: 0x1112_1314,
  targetCenterY256: 0x2122_2324,
  viewportWidth256: 0x3132_3334,
  viewportHeight256: 0x4142_4344,
  offsetX256: -1,
  offsetY256: -0x8000_0000,
  pointerType: 3,
};

describe("click transcript", () => {
  test("uses a fixed-width, big-endian canonical encoding", () => {
    const encoded = encodeClickTranscript([sample]);

    expect(encoded.length).toBe(
      TRANSCRIPT_HEADER_BYTES + TRANSCRIPT_SAMPLE_BYTES,
    );
    expect(bytesToHex(encoded)).toBe(
      "574841434b524e4700010001" +
        "12340102030411121314212223243132333441424344ffffffff8000000003",
    );
  });

  test("preserves order and records the sample count", () => {
    const encoded = encodeClickTranscript([
      { ...sample, targetNumber: 1 },
      { ...sample, targetNumber: 2 },
    ]);
    const view = new DataView(encoded.buffer);

    expect(view.getUint16(10, false)).toBe(2);
    expect(view.getUint16(TRANSCRIPT_HEADER_BYTES, false)).toBe(1);
    expect(
      view.getUint16(TRANSCRIPT_HEADER_BYTES + TRANSCRIPT_SAMPLE_BYTES, false),
    ).toBe(2);
  });

  test("rejects fields outside their fixed-width range", () => {
    expect(() =>
      encodeClickTranscript([{ ...sample, pointerType: 4 }]),
    ).toThrow(RangeError);
    expect(() =>
      encodeClickTranscript([{ ...sample, targetNumber: 0 }]),
    ).toThrow(RangeError);
  });
});

describe("measurement quantization", () => {
  test("quantizes timing and coordinates deterministically", () => {
    expect(quantizeMicroseconds(1.2345)).toBe(1_235);
    expect(quantizeUnsignedFixed256(12.25)).toBe(3_136);
    expect(quantizeSignedFixed256(-1.5)).toBe(-384);
  });

  test("clamps values to their encoded integer range", () => {
    expect(quantizeMicroseconds(-1)).toBe(0);
    expect(quantizeUnsignedFixed256(Number.MAX_VALUE)).toBe(0xffff_ffff);
    expect(quantizeSignedFixed256(-Number.MAX_VALUE)).toBe(-0x8000_0000);
  });

  test("maps browser pointer types to stable codes", () => {
    expect(pointerTypeCode("mouse")).toBe(1);
    expect(pointerTypeCode("pen")).toBe(2);
    expect(pointerTypeCode("touch")).toBe(3);
    expect(pointerTypeCode("keyboard")).toBe(0);
  });
});

describe("hybrid seed", () => {
  test("draws OS bytes after hashing and XORs both 32-byte values", async () => {
    const transcript = new TextEncoder().encode("ordered click transcript");
    const originalTranscript = transcript.slice();
    const osBytes = Uint8Array.from({ length: 32 }, (_, index) => index * 7);
    const events: string[] = [];
    let randomTarget: Uint8Array | undefined;

    const subtle = {
      async digest(algorithm: AlgorithmIdentifier, data: BufferSource) {
        events.push("digest");
        return globalThis.crypto.subtle.digest(algorithm, data);
      },
    } as SubtleCrypto;
    const cryptoSource = {
      subtle,
      getRandomValues<ArrayType extends ArrayBufferView | null>(
        target: ArrayType,
      ): ArrayType {
        events.push("random");
        if (!(target instanceof Uint8Array)) throw new TypeError("Bad target");
        randomTarget = target;
        target.set(osBytes);
        return target;
      },
    } as unknown as Crypto;

    const seed = await makeHybridSeed(transcript, cryptoSource);
    const digest = new Uint8Array(
      await globalThis.crypto.subtle.digest("SHA-256", transcript),
    );
    const expected = digest.map((byte, index) => byte ^ (osBytes[index] ?? 0));

    expect(events).toEqual(["digest", "random"]);
    expect(seed).toEqual(expected);
    expect(transcript).toEqual(originalTranscript);
    expect(randomTarget).toEqual(new Uint8Array(32));
  });
});

describe("HMAC-SHA-256 generator", () => {
  const seed = Uint8Array.from({ length: 32 }, (_, index) => index);

  test("uses the specified domain and a big-endian uint64 counter", async () => {
    const generator = await HmacSha256Generator.create(seed);
    const actual = await generator.nextBytes(32);
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      seed,
      { hash: "SHA-256", name: "HMAC" },
      false,
      ["sign"],
    );
    const domain = new TextEncoder().encode("whack-rng-v1");
    const input = new Uint8Array(domain.length + 8);
    input.set(domain);
    const expected = new Uint8Array(
      await globalThis.crypto.subtle.sign("HMAC", key, input),
    );

    expect(actual).toEqual(expected);
    expect(generator.blocksGenerated).toBe(1n);
    generator.dispose();
  });

  test("preserves one continuous stream across split and concurrent reads", async () => {
    const splitGenerator = await HmacSha256Generator.create(seed);
    const splitParts = await Promise.all([
      splitGenerator.nextBytes(7),
      splitGenerator.nextBytes(25),
      splitGenerator.nextBytes(32),
    ]);
    const split = new Uint8Array(64);
    let offset = 0;
    for (const part of splitParts) {
      split.set(part, offset);
      offset += part.length;
    }

    const wholeGenerator = await HmacSha256Generator.create(seed);
    const whole = await wholeGenerator.nextBytes(64);

    expect(split).toEqual(whole);
    expect(splitGenerator.blocksGenerated).toBe(2n);
    splitGenerator.dispose();
    wholeGenerator.dispose();
  });

  test("rejects reads after disposal", async () => {
    const generator = await HmacSha256Generator.create(seed);
    generator.dispose();
    expect(generator.nextBytes(1)).rejects.toThrow("disposed");
  });
});
