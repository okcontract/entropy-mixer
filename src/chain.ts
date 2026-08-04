import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

import { bytesToHex } from "./format.ts";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BECH32_ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GENERATORS = [
  0x3b6a_57b2, 0x2650_8e6d, 0x1ea1_19fa, 0x3d42_33dd, 0x2a14_62b3,
] as const;
const textEncoder = new TextEncoder();

export type ChainKey = Readonly<{
  address: string;
  privateKey: string;
}>;

export type RandomByteStream = Readonly<{
  nextBytes(length: number): Promise<Uint8Array>;
}>;

const concatBytes = (...parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(
    parts.reduce((length, part) => length + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};

const encodeBase58 = (bytes: Uint8Array): string => {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);

  let encoded = "";
  while (value > 0n) {
    const digit = Number(value % 58n);
    encoded = (BASE58_ALPHABET[digit] ?? "") + encoded;
    value /= 58n;
  }

  let leadingZeroes = 0;
  while (bytes[leadingZeroes] === 0) leadingZeroes += 1;
  return "1".repeat(leadingZeroes) + encoded;
};

const encodeBase58Check = (payload: Uint8Array): string => {
  const firstHash = sha256(payload);
  const secondHash = sha256(firstHash);
  const checked = concatBytes(payload, secondHash.subarray(0, 4));
  try {
    return encodeBase58(checked);
  } finally {
    firstHash.fill(0);
    secondHash.fill(0);
    checked.fill(0);
  }
};

const bech32Polymod = (values: readonly number[]): number => {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = (((checksum & 0x1ff_ffff) << 5) ^ value) >>> 0;
    for (let index = 0; index < BECH32_GENERATORS.length; index += 1) {
      if (((top >>> index) & 1) !== 0) {
        checksum = (checksum ^ (BECH32_GENERATORS[index] ?? 0)) >>> 0;
      }
    }
  }
  return checksum;
};

const bech32Checksum = (
  humanReadablePart: string,
  data: readonly number[],
): number[] => {
  const values: number[] = [];
  for (const character of humanReadablePart) {
    values.push(character.charCodeAt(0) >>> 5);
  }
  values.push(0);
  for (const character of humanReadablePart) {
    values.push(character.charCodeAt(0) & 31);
  }
  values.push(...data, 0, 0, 0, 0, 0, 0);

  const polymod = (bech32Polymod(values) ^ 1) >>> 0;
  return Array.from(
    { length: 6 },
    (_, index) => (polymod >>> (5 * (5 - index))) & 31,
  );
};

const bytesToBech32Words = (bytes: Uint8Array): number[] => {
  const words: number[] = [];
  let accumulator = 0;
  let bitCount = 0;

  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      words.push((accumulator >>> bitCount) & 31);
    }
    accumulator &= (1 << bitCount) - 1;
  }

  if (bitCount > 0) words.push((accumulator << (5 - bitCount)) & 31);
  return words;
};

const encodeP2wpkhAddress = (publicKeyHash: Uint8Array): string => {
  if (publicKeyHash.length !== 20) {
    throw new TypeError("Expected a 20-byte public-key hash");
  }

  const humanReadablePart = "bc";
  const data = [0, ...bytesToBech32Words(publicKeyHash)];
  const encoded = [...data, ...bech32Checksum(humanReadablePart, data)]
    .map((value) => BECH32_ALPHABET[value] ?? "")
    .join("");
  return `${humanReadablePart}1${encoded}`;
};

const assertValidSecretKey = (secretKey: Uint8Array) => {
  if (!secp256k1.utils.isValidSecretKey(secretKey)) {
    throw new RangeError("Expected a valid 32-byte secp256k1 secret key");
  }
};

export const isValidSecp256k1SecretKey = (secretKey: Uint8Array): boolean =>
  secp256k1.utils.isValidSecretKey(secretKey);

export const nextSecp256k1SecretKey = async (
  stream: RandomByteStream,
): Promise<Uint8Array> => {
  for (;;) {
    const candidate = await stream.nextBytes(32);
    if (candidate.length !== 32) {
      candidate.fill(0);
      throw new Error("Random byte stream returned the wrong length");
    }
    if (isValidSecp256k1SecretKey(candidate)) return candidate;
    candidate.fill(0);
  }
};

export const deriveBitcoinAddress = (secretKey: Uint8Array): string => {
  assertValidSecretKey(secretKey);

  const publicKey = secp256k1.getPublicKey(secretKey, true);
  const publicKeySha256 = sha256(publicKey);
  const publicKeyHash = ripemd160(publicKeySha256);
  try {
    return encodeP2wpkhAddress(publicKeyHash);
  } finally {
    publicKey.fill(0);
    publicKeySha256.fill(0);
    publicKeyHash.fill(0);
  }
};

export const deriveBitcoinKey = (secretKey: Uint8Array): ChainKey => {
  const address = deriveBitcoinAddress(secretKey);
  const wifPayload = concatBytes(
    Uint8Array.of(0x80),
    secretKey,
    Uint8Array.of(1),
  );
  try {
    return {
      address,
      privateKey: encodeBase58Check(wifPayload),
    };
  } finally {
    wifPayload.fill(0);
  }
};

export const checksumEthereumAddress = (lowercaseAddress: string): string => {
  if (!/^[0-9a-f]{40}$/.test(lowercaseAddress)) {
    throw new TypeError("Expected a lowercase 20-byte hexadecimal address");
  }

  const hash = bytesToHex(keccak_256(textEncoder.encode(lowercaseAddress)));
  let checksummed = "0x";
  for (let index = 0; index < lowercaseAddress.length; index += 1) {
    const character = lowercaseAddress[index] ?? "";
    checksummed +=
      character >= "a" && Number.parseInt(hash[index] ?? "0", 16) >= 8
        ? character.toUpperCase()
        : character;
  }
  return checksummed;
};

export const deriveEthereumAddress = (secretKey: Uint8Array): string => {
  assertValidSecretKey(secretKey);

  const publicKey = secp256k1.getPublicKey(secretKey, false);
  const publicKeyHash = keccak_256(publicKey.subarray(1));
  try {
    return checksumEthereumAddress(bytesToHex(publicKeyHash.subarray(12)));
  } finally {
    publicKey.fill(0);
    publicKeyHash.fill(0);
  }
};

export const deriveEthereumKey = (secretKey: Uint8Array): ChainKey => ({
  address: deriveEthereumAddress(secretKey),
  privateKey: `0x${bytesToHex(secretKey)}`,
});
