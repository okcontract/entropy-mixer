import { HARDENED_OFFSET, HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedWebcrypto } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

import { deriveBitcoinAddress, deriveEthereumAddress } from "./chain.ts";

export type MnemonicWordCount = 12 | 24;
export type MnemonicAddresses = Readonly<{
  bitcoin: string;
  ethereum: string;
}>;
export type MnemonicBatch = Readonly<{
  phrases: string;
  bitcoinAddresses: string;
  ethereumAddresses: string;
}>;

type MnemonicBatchOptions = Readonly<{
  deriveAddresses?: (mnemonic: string) => Promise<MnemonicAddresses>;
  isActive?: () => boolean;
}>;

export const BITCOIN_PREVIEW_PATH = "m/84'/0'/0'/0/0";
export const ETHEREUM_PREVIEW_PATH = "m/44'/60'/0'/0/0";
const hardened = (index: number): number => HARDENED_OFFSET + index;
const BITCOIN_PREVIEW_INDEXES = [
  hardened(84),
  hardened(0),
  hardened(0),
  0,
  0,
] as const;
const ETHEREUM_PREVIEW_INDEXES = [
  hardened(44),
  hardened(60),
  hardened(0),
  0,
  0,
] as const;

export const mnemonicEntropyLength = (
  wordCount: MnemonicWordCount,
): 16 | 32 => {
  if (wordCount === 12) return 16;
  if (wordCount === 24) return 32;
  throw new RangeError("Supported BIP-39 phrases contain 12 or 24 words");
};

export const formatMnemonicBatch = (
  entropy: Uint8Array,
  wordCount: MnemonicWordCount,
): string => {
  const entropyLength = mnemonicEntropyLength(wordCount);
  if (entropy.length % entropyLength !== 0) {
    throw new RangeError(
      "Mnemonic entropy length must divide the batch exactly",
    );
  }

  const phrases: string[] = [];
  for (let offset = 0; offset < entropy.length; offset += entropyLength) {
    phrases.push(
      entropyToMnemonic(
        entropy.subarray(offset, offset + entropyLength),
        wordlist,
      ),
    );
  }
  return phrases.join("\n");
};

const wipeHdKey = (key: HDKey) => {
  key.wipePrivateData();
  key.chainCode?.fill(0);
};

const deriveAddress = (
  root: HDKey,
  path: string,
  indexes: readonly number[],
  fromSecretKey: (secretKey: Uint8Array) => string,
): string => {
  let child: HDKey | undefined;
  try {
    for (const index of indexes) {
      const next = (child ?? root).deriveChild(index);
      if (child) wipeHdKey(child);
      child = next;
    }
    const secretKey = child?.privateKey;
    if (!secretKey) throw new Error(`No private key at ${path}`);
    return fromSecretKey(secretKey);
  } finally {
    if (child) wipeHdKey(child);
  }
};

export const deriveMnemonicAddresses = async (
  mnemonic: string,
): Promise<MnemonicAddresses> => {
  const seed = await mnemonicToSeedWebcrypto(mnemonic, "");
  let root: HDKey | undefined;
  try {
    root = HDKey.fromMasterSeed(seed);
    return {
      bitcoin: deriveAddress(
        root,
        BITCOIN_PREVIEW_PATH,
        BITCOIN_PREVIEW_INDEXES,
        deriveBitcoinAddress,
      ),
      ethereum: deriveAddress(
        root,
        ETHEREUM_PREVIEW_PATH,
        ETHEREUM_PREVIEW_INDEXES,
        deriveEthereumAddress,
      ),
    };
  } finally {
    if (root) wipeHdKey(root);
    seed.fill(0);
  }
};

export const deriveMnemonicBatch = async (
  entropy: Uint8Array,
  wordCount: MnemonicWordCount,
  options: MnemonicBatchOptions = {},
): Promise<MnemonicBatch | undefined> => {
  const { deriveAddresses = deriveMnemonicAddresses, isActive = () => true } =
    options;
  let phrases = "";
  try {
    if (!isActive()) return;
    phrases = formatMnemonicBatch(entropy, wordCount);
  } finally {
    entropy.fill(0);
  }

  const bitcoinAddresses: string[] = [];
  const ethereumAddresses: string[] = [];
  for (const phrase of phrases.split("\n")) {
    if (!isActive()) return;
    const addresses = await deriveAddresses(phrase);
    if (!isActive()) return;
    bitcoinAddresses.push(addresses.bitcoin);
    ethereumAddresses.push(addresses.ethereum);
  }

  return {
    phrases,
    bitcoinAddresses: bitcoinAddresses.join("\n"),
    ethereumAddresses: ethereumAddresses.join("\n"),
  };
};
