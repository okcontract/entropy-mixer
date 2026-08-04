import { describe, expect, test } from "bun:test";

import {
  checksumEthereumAddress,
  deriveBitcoinAddress,
  deriveBitcoinKey,
  deriveEthereumAddress,
  deriveEthereumKey,
  isValidSecp256k1SecretKey,
  nextSecp256k1SecretKey,
} from "./chain.ts";
import { HmacSha256Generator } from "./entropy.ts";

const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from({ length: hex.length / 2 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );

const secretKeyOne = hexToBytes(`${"0".repeat(63)}1`);
const curveOrder =
  "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141";

describe("secp256k1 secret keys", () => {
  test("accepts exactly the scalar range from one through n minus one", () => {
    const orderMinusOne =
      "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140";

    expect(isValidSecp256k1SecretKey(new Uint8Array(32))).toBe(false);
    expect(isValidSecp256k1SecretKey(secretKeyOne)).toBe(true);
    expect(isValidSecp256k1SecretKey(hexToBytes(orderMinusOne))).toBe(true);
    expect(isValidSecp256k1SecretKey(hexToBytes(curveOrder))).toBe(false);
  });

  test("rejects invalid candidates instead of reducing modulo n", async () => {
    const invalid = hexToBytes(curveOrder);
    const candidates = [invalid, secretKeyOne.slice()];
    const actual = await nextSecp256k1SecretKey({
      async nextBytes() {
        const candidate = candidates.shift();
        if (!candidate) throw new Error("No candidate available");
        return candidate;
      },
    });

    expect(invalid).toEqual(new Uint8Array(32));
    expect(actual).toEqual(secretKeyOne);
  });

  test("draws multiple keys from the continuous HMAC stream", async () => {
    const generator = await HmacSha256Generator.create(new Uint8Array(32));
    const first = await nextSecp256k1SecretKey(generator);
    const second = await nextSecp256k1SecretKey(generator);

    expect(first).not.toEqual(second);
    expect(generator.blocksGenerated).toBe(2n);

    first.fill(0);
    second.fill(0);
    generator.dispose();
  });
});

describe("Bitcoin keys", () => {
  test("derives compressed mainnet WIF and native SegWit address", () => {
    expect(deriveBitcoinAddress(secretKeyOne)).toBe(
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    );
    expect(deriveBitcoinKey(secretKeyOne)).toEqual({
      privateKey: "KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn",
      address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    });
  });
});

describe("Ethereum keys", () => {
  test("derives an EOA private key and checksummed address", () => {
    expect(deriveEthereumAddress(secretKeyOne)).toBe(
      "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
    );
    expect(deriveEthereumKey(secretKeyOne)).toEqual({
      privateKey: `0x${"0".repeat(63)}1`,
      address: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
    });
  });

  test("matches ERC-55 checksum vectors", () => {
    expect(
      checksumEthereumAddress("52908400098527886e0f7030069857d2e4169ee7"),
    ).toBe("0x52908400098527886E0F7030069857D2E4169EE7");
    expect(
      checksumEthereumAddress("5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"),
    ).toBe("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
  });
});
