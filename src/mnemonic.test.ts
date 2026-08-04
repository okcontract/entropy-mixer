import { describe, expect, test } from "bun:test";

import {
  BITCOIN_PREVIEW_PATH,
  deriveMnemonicAddresses,
  deriveMnemonicBatch,
  ETHEREUM_PREVIEW_PATH,
  formatMnemonicBatch,
  type MnemonicAddresses,
  mnemonicEntropyLength,
} from "./mnemonic.ts";

describe("BIP-39 mnemonic phrases", () => {
  test("maps supported word counts to their entropy lengths", () => {
    expect(mnemonicEntropyLength(12)).toBe(16);
    expect(mnemonicEntropyLength(24)).toBe(32);
  });

  test("matches the official all-zero English vectors", () => {
    expect(formatMnemonicBatch(new Uint8Array(16), 12)).toBe(
      `${"abandon ".repeat(11)}about`,
    );
    expect(formatMnemonicBatch(new Uint8Array(32), 24)).toBe(
      `${"abandon ".repeat(23)}art`,
    );
  });

  test("renders one phrase per line and rejects partial entropy", () => {
    const entropy = new Uint8Array(32);
    entropy.fill(0x7f, 16);

    expect(formatMnemonicBatch(entropy, 12)).toBe(
      [
        `${"abandon ".repeat(11)}about`,
        "legal winner thank year wave sausage worth useful legal winner thank yellow",
      ].join("\n"),
    );
    expect(() => formatMnemonicBatch(new Uint8Array(17), 12)).toThrow(
      RangeError,
    );
  });

  test("derives the standard first Bitcoin and Ethereum addresses", async () => {
    const mnemonic = `${"abandon ".repeat(11)}about`;

    expect(BITCOIN_PREVIEW_PATH).toBe("m/84'/0'/0'/0/0");
    expect(ETHEREUM_PREVIEW_PATH).toBe("m/44'/60'/0'/0/0");
    expect(await deriveMnemonicAddresses(mnemonic)).toEqual({
      bitcoin: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
      ethereum: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
    });
  });

  test("keeps multi-phrase address rows aligned", async () => {
    const entropy = new Uint8Array(32);
    entropy.fill(0x7f, 16);
    const phrases = formatMnemonicBatch(entropy, 12).split("\n");
    const derivedPhrases: string[] = [];

    const batch = await deriveMnemonicBatch(entropy, 12, {
      deriveAddresses: async (phrase) => {
        const index = derivedPhrases.push(phrase) - 1;
        return {
          bitcoin: `bitcoin-${index}`,
          ethereum: `ethereum-${index}`,
        };
      },
    });

    expect(derivedPhrases).toEqual(phrases);
    expect(batch).toEqual({
      phrases: phrases.join("\n"),
      bitcoinAddresses: "bitcoin-0\nbitcoin-1",
      ethereumAddresses: "ethereum-0\nethereum-1",
    });
    expect(entropy).toEqual(new Uint8Array(32));
  });

  test("discards an address batch invalidated during derivation", async () => {
    const entropy = new Uint8Array(16).fill(7);
    let active = true;
    let derivationStarted = false;
    let releaseAddresses = (_addresses: MnemonicAddresses): void => undefined;
    const pendingAddresses = new Promise<MnemonicAddresses>((resolve) => {
      releaseAddresses = resolve;
    });

    const pendingBatch = deriveMnemonicBatch(entropy, 12, {
      deriveAddresses: () => {
        derivationStarted = true;
        return pendingAddresses;
      },
      isActive: () => active,
    });
    expect(derivationStarted).toBe(true);

    active = false;
    releaseAddresses({ bitcoin: "discarded", ethereum: "discarded" });

    expect(await pendingBatch).toBeUndefined();
    expect(entropy).toEqual(new Uint8Array(16));
  });
});
