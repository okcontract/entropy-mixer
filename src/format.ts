const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export type OutputEncoding = "base64" | "hex";

export type ChainKeyOutput = Readonly<{
  address: string;
  privateKey: string;
}>;

export const bytesToHex = (bytes: Uint8Array): string => {
  let encoded = "";
  for (const byte of bytes) encoded += byte.toString(16).padStart(2, "0");
  return encoded;
};

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let encoded = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset] ?? 0;
    const second = bytes[offset + 1];
    const third = bytes[offset + 2];
    const packed = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);

    encoded += BASE64_ALPHABET[(packed >>> 18) & 0x3f];
    encoded += BASE64_ALPHABET[(packed >>> 12) & 0x3f];
    encoded +=
      second === undefined ? "=" : BASE64_ALPHABET[(packed >>> 6) & 0x3f];
    encoded += third === undefined ? "=" : BASE64_ALPHABET[packed & 0x3f];
  }
  return encoded;
};

export const formatBytes = (
  bytes: Uint8Array,
  encoding: OutputEncoding,
): string => (encoding === "hex" ? bytesToHex(bytes) : bytesToBase64(bytes));

export const formatKeyBatch = (
  bytes: Uint8Array,
  keyLength: number,
  encoding: OutputEncoding,
): string => {
  if (
    !Number.isSafeInteger(keyLength) ||
    keyLength <= 0 ||
    bytes.length % keyLength !== 0
  ) {
    throw new RangeError("Key length must divide the byte array exactly");
  }

  const keys: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += keyLength) {
    keys.push(
      formatBytes(bytes.subarray(offset, offset + keyLength), encoding),
    );
  }
  return keys.join("\n");
};

export const formatChainKeyBatch = (
  keys: readonly ChainKeyOutput[],
): Readonly<{ addresses: string; privateKeys: string }> => ({
  addresses: keys.map(({ address }) => address).join("\n"),
  privateKeys: keys.map(({ privateKey }) => privateKey).join("\n"),
});
