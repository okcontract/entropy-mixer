const TRANSCRIPT_MAGIC = new Uint8Array([
  0x57, 0x48, 0x41, 0x43, 0x4b, 0x52, 0x4e, 0x47,
]);
const HMAC_DOMAIN = new TextEncoder().encode("whack-rng-v1");
const UINT32_MAX = 0xffff_ffff;
const INT32_MIN = -0x8000_0000;
const INT32_MAX = 0x7fff_ffff;
const UINT64_MAX = 0xffff_ffff_ffff_ffffn;

export const TRANSCRIPT_VERSION = 1;
export const TRANSCRIPT_HEADER_BYTES = 12;
export const TRANSCRIPT_SAMPLE_BYTES = 31;

export type ClickSample = Readonly<{
  targetNumber: number;
  reactionTimeMicroseconds: number;
  targetCenterX256: number;
  targetCenterY256: number;
  viewportWidth256: number;
  viewportHeight256: number;
  offsetX256: number;
  offsetY256: number;
  pointerType: number;
}>;

const assertInteger = (
  name: string,
  value: number,
  minimum: number,
  maximum: number,
) => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${name} must be an integer from ${minimum} to ${maximum}`,
    );
  }
};

export const quantizeUnsignedFixed256 = (value: number): number => {
  if (!Number.isFinite(value)) throw new TypeError("Expected a finite number");
  return Math.min(UINT32_MAX, Math.max(0, Math.round(value * 256)));
};

export const quantizeSignedFixed256 = (value: number): number => {
  if (!Number.isFinite(value)) throw new TypeError("Expected a finite number");
  return Math.min(INT32_MAX, Math.max(INT32_MIN, Math.round(value * 256)));
};

export const quantizeMicroseconds = (milliseconds: number): number => {
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError("Expected a finite duration");
  }
  return Math.min(UINT32_MAX, Math.max(0, Math.round(milliseconds * 1_000)));
};

export const pointerTypeCode = (pointerType: string): number => {
  if (pointerType === "mouse") return 1;
  if (pointerType === "pen") return 2;
  if (pointerType === "touch") return 3;
  return 0;
};

export const encodeClickTranscript = (
  samples: readonly ClickSample[],
): Uint8Array<ArrayBuffer> => {
  if (samples.length > 0xffff) {
    throw new RangeError("A transcript can contain at most 65535 samples");
  }

  const encoded = new Uint8Array(
    TRANSCRIPT_HEADER_BYTES + samples.length * TRANSCRIPT_SAMPLE_BYTES,
  );
  encoded.set(TRANSCRIPT_MAGIC);
  const view = new DataView(encoded.buffer);
  view.setUint16(8, TRANSCRIPT_VERSION, false);
  view.setUint16(10, samples.length, false);

  let offset = TRANSCRIPT_HEADER_BYTES;
  for (const sample of samples) {
    assertInteger("targetNumber", sample.targetNumber, 1, 0xffff);
    assertInteger(
      "reactionTimeMicroseconds",
      sample.reactionTimeMicroseconds,
      0,
      UINT32_MAX,
    );
    assertInteger("targetCenterX256", sample.targetCenterX256, 0, UINT32_MAX);
    assertInteger("targetCenterY256", sample.targetCenterY256, 0, UINT32_MAX);
    assertInteger("viewportWidth256", sample.viewportWidth256, 0, UINT32_MAX);
    assertInteger("viewportHeight256", sample.viewportHeight256, 0, UINT32_MAX);
    assertInteger("offsetX256", sample.offsetX256, INT32_MIN, INT32_MAX);
    assertInteger("offsetY256", sample.offsetY256, INT32_MIN, INT32_MAX);
    assertInteger("pointerType", sample.pointerType, 0, 3);

    view.setUint16(offset, sample.targetNumber, false);
    view.setUint32(offset + 2, sample.reactionTimeMicroseconds, false);
    view.setUint32(offset + 6, sample.targetCenterX256, false);
    view.setUint32(offset + 10, sample.targetCenterY256, false);
    view.setUint32(offset + 14, sample.viewportWidth256, false);
    view.setUint32(offset + 18, sample.viewportHeight256, false);
    view.setInt32(offset + 22, sample.offsetX256, false);
    view.setInt32(offset + 26, sample.offsetY256, false);
    view.setUint8(offset + 30, sample.pointerType);
    offset += TRANSCRIPT_SAMPLE_BYTES;
  }

  return encoded;
};

export const makeHybridSeed = async (
  clickTranscriptBytes: Uint8Array,
  cryptoSource: Crypto = globalThis.crypto,
): Promise<Uint8Array<ArrayBuffer>> => {
  if (!(clickTranscriptBytes instanceof Uint8Array)) {
    throw new TypeError("Expected a Uint8Array");
  }

  const transcriptCopy = new Uint8Array(clickTranscriptBytes.length);
  transcriptCopy.set(clickTranscriptBytes);
  let clickDigest: Uint8Array;
  try {
    clickDigest = new Uint8Array(
      await cryptoSource.subtle.digest("SHA-256", transcriptCopy),
    );
  } finally {
    transcriptCopy.fill(0);
  }
  const osRandom = new Uint8Array(32);

  try {
    cryptoSource.getRandomValues(osRandom);
    const seed = new Uint8Array(32);
    for (let index = 0; index < seed.length; index += 1) {
      seed[index] = (osRandom[index] ?? 0) ^ (clickDigest[index] ?? 0);
    }
    return seed;
  } finally {
    osRandom.fill(0);
    clickDigest.fill(0);
  }
};

export class HmacSha256Generator {
  private counter = 0n;
  private disposed = false;
  private key: CryptoKey | null;
  private remainder = new Uint8Array(0);
  private remainderOffset = 0;
  private requestTail: Promise<void> = Promise.resolve();

  private constructor(
    key: CryptoKey,
    private readonly subtle: SubtleCrypto,
  ) {
    this.key = key;
  }

  static async create(
    seed: Uint8Array,
    subtle: SubtleCrypto = globalThis.crypto.subtle,
  ): Promise<HmacSha256Generator> {
    if (!(seed instanceof Uint8Array) || seed.length !== 32) {
      throw new TypeError("Expected a 32-byte seed");
    }

    const keyBytes = seed.slice();
    try {
      const key = await subtle.importKey(
        "raw",
        keyBytes,
        { hash: "SHA-256", name: "HMAC" },
        false,
        ["sign"],
      );
      return new HmacSha256Generator(key, subtle);
    } finally {
      keyBytes.fill(0);
    }
  }

  get blocksGenerated(): bigint {
    return this.counter;
  }

  nextBytes(length: number): Promise<Uint8Array<ArrayBuffer>> {
    if (!Number.isSafeInteger(length) || length < 0) {
      return Promise.reject(
        new RangeError("Length must be a non-negative integer"),
      );
    }

    const request = this.requestTail.then(() => this.generateBytes(length));
    this.requestTail = request.then(
      () => undefined,
      () => undefined,
    );
    return request;
  }

  dispose(): void {
    this.disposed = true;
    this.key = null;
    this.remainder.fill(0);
    this.remainder = new Uint8Array(0);
    this.remainderOffset = 0;
  }

  private async generateBytes(
    length: number,
  ): Promise<Uint8Array<ArrayBuffer>> {
    if (this.disposed || !this.key) throw new Error("Generator is disposed");

    const output = new Uint8Array(length);
    let outputOffset = 0;

    if (this.remainderOffset < this.remainder.length) {
      const available = this.remainder.length - this.remainderOffset;
      const copied = Math.min(available, length);
      output.set(
        this.remainder.subarray(
          this.remainderOffset,
          this.remainderOffset + copied,
        ),
      );
      this.remainderOffset += copied;
      outputOffset += copied;
      if (this.remainderOffset === this.remainder.length) {
        this.remainder.fill(0);
        this.remainder = new Uint8Array(0);
        this.remainderOffset = 0;
      }
    }

    while (outputOffset < length) {
      const block = await this.nextBlock();
      if (this.disposed) {
        block.fill(0);
        output.fill(0);
        throw new Error("Generator is disposed");
      }

      const copied = Math.min(block.length, length - outputOffset);
      output.set(block.subarray(0, copied), outputOffset);
      outputOffset += copied;

      if (copied < block.length) {
        this.remainder = block;
        this.remainderOffset = copied;
      } else {
        block.fill(0);
      }
    }

    return output;
  }

  private async nextBlock(): Promise<Uint8Array<ArrayBuffer>> {
    if (!this.key) throw new Error("Generator is disposed");
    if (this.counter > UINT64_MAX) throw new Error("HMAC counter exhausted");

    const input = new Uint8Array(HMAC_DOMAIN.length + 8);
    input.set(HMAC_DOMAIN);
    new DataView(input.buffer).setBigUint64(
      HMAC_DOMAIN.length,
      this.counter,
      false,
    );
    this.counter += 1n;

    try {
      return new Uint8Array(await this.subtle.sign("HMAC", this.key, input));
    } finally {
      input.fill(0);
    }
  }
}
