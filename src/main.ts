import "./style.css";

import {
  type ChainKey,
  deriveBitcoinKey,
  deriveEthereumKey,
  nextSecp256k1SecretKey,
} from "./chain.ts";
import { bindCopyControls } from "./copy.ts";
import {
  type ClickSample,
  encodeClickTranscript,
  HmacSha256Generator,
  makeHybridSeed,
  pointerTypeCode,
  quantizeMicroseconds,
  quantizeSignedFixed256,
  quantizeUnsignedFixed256,
} from "./entropy.ts";
import {
  formatChainKeyBatch,
  formatKeyBatch,
  type OutputEncoding,
} from "./format.ts";
import {
  isPrimaryPointerActivation,
  TARGET_COUNT,
  targetPosition,
} from "./game.ts";
import { resetOnPageHide } from "./lifecycle.ts";
import {
  BITCOIN_PREVIEW_PATH,
  deriveMnemonicBatch,
  ETHEREUM_PREVIEW_PATH,
  type MnemonicWordCount,
  mnemonicEntropyLength,
} from "./mnemonic.ts";

type Phase = "collecting" | "deriving" | "error" | "idle" | "ready";
type KeyType =
  | "bip39-12"
  | "bip39-24"
  | "bitcoin"
  | "ethereum"
  | "raw-128"
  | "raw-256";

const PRIVATE_COPY_PROMPT =
  "Copy secret material to the system clipboard? Clipboard history and other applications may retain it.";

const required = <ElementType extends Element>(
  selector: string,
): ElementType => {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
};

const arenaOverlay = required<HTMLDivElement>("#arena-overlay");
const bitcoinAddressOutput = required<HTMLTextAreaElement>(
  "#bitcoin-address-output",
);
const bitcoinCopyFeedback = required<HTMLSpanElement>("#bitcoin-copy-feedback");
const bitcoinOutputArea = required<HTMLElement>("#bitcoin-output-area");
const bitcoinOutputLabel = required<HTMLLabelElement>("#bitcoin-output-label");
const clickProgress = required<HTMLDivElement>("#click-progress");
const copyBitcoinAddresses = required<HTMLButtonElement>(
  "#copy-bitcoin-addresses",
);
const copyEthereumAddresses = required<HTMLButtonElement>(
  "#copy-ethereum-addresses",
);
const copyPrivateKeys = required<HTMLButtonElement>("#copy-private-keys");
const ethereumAddressOutput = required<HTMLTextAreaElement>(
  "#ethereum-address-output",
);
const ethereumCopyFeedback = required<HTMLSpanElement>(
  "#ethereum-copy-feedback",
);
const ethereumOutputArea = required<HTMLElement>("#ethereum-output-area");
const ethereumOutputLabel = required<HTMLLabelElement>(
  "#ethereum-output-label",
);
const cryptoStatus = required<HTMLOutputElement>("#crypto-status");
const encodingField = required<HTMLFieldSetElement>(".encoding");
const generateKeys = required<HTMLButtonElement>("#generate-keys");
const gameStage = required<HTMLDivElement>("#game-stage");
const generationStage = required<HTMLDivElement>("#generation-stage");
const keyCount = required<HTMLSelectElement>("#key-count");
const keyType = required<HTMLSelectElement>("#key-type");
const mnemonicPreviewSettings = required<HTMLParagraphElement>(
  "#mnemonic-preview-settings",
);
const outputMeta = required<HTMLSpanElement>("#output-meta");
const overlayCopy = required<HTMLParagraphElement>("#overlay-copy");
const progressFill = required<HTMLSpanElement>("#progress-fill");
const progressLabel = required<HTMLSpanElement>("#progress-label");
const privateCopyFeedback = required<HTMLSpanElement>("#private-copy-feedback");
const privateKeyOutput = required<HTMLTextAreaElement>("#private-key-output");
const privateOutputLabel = required<HTMLLabelElement>("#private-output-label");
const resetGame = required<HTMLButtonElement>("#reset-game");
const startGame = required<HTMLButtonElement>("#start-game");
const stageTitle = required<HTMLHeadingElement>("#stage-title");
const target = required<HTMLButtonElement>("#target");
const encodingInputs = [
  ...document.querySelectorAll<HTMLInputElement>('input[name="encoding"]'),
];

let phase: Phase = "idle";
let samples: ClickSample[] = [];
let currentTargetIndex = 0;
let targetShownAt = 0;
let scheduledFrame: number | undefined;
let runToken = 0;
let keyboardMode = false;
let generator: HmacSha256Generator | undefined;
let lastKeyBatch: Uint8Array | undefined;
let lastPrivateBatch: string | undefined;
let lastBitcoinBatch: string | undefined;
let lastEthereumBatch: string | undefined;
let lastKeyLength = 0;
let batchNumber = 0;
let copyTimer: number | undefined;
let privateCopyEventApproved = false;

const showGenerationStage = (visible: boolean) => {
  gameStage.hidden = visible;
  generationStage.hidden = !visible;
  stageTitle.textContent = visible ? "2. Generate" : "1. Collect samples";
};

const setProgress = (count: number) => {
  clickProgress.setAttribute("aria-valuenow", String(count));
  progressFill.style.width = `${(count / TARGET_COUNT) * 100}%`;
  progressLabel.textContent = `${count} / ${TARGET_COUNT}`;
};

const showOverlay = (copy: string, action?: string) => {
  target.hidden = true;
  arenaOverlay.hidden = false;
  overlayCopy.textContent = copy;
  startGame.hidden = action === undefined;
  if (action !== undefined) startGame.textContent = action;
};

const selectedKeyType = (): KeyType => {
  switch (keyType.value) {
    case "bip39-12":
    case "bip39-24":
    case "bitcoin":
    case "ethereum":
    case "raw-128":
      return keyType.value;
    default:
      return "raw-256";
  }
};

const isRawKeyType = (value: KeyType): boolean => value.startsWith("raw-");
const isMnemonicKeyType = (value: KeyType): boolean =>
  value === "bip39-12" || value === "bip39-24";

const setControlsEnabled = (enabled: boolean) => {
  keyType.disabled = !enabled;
  keyCount.disabled = !enabled;
  encodingField.disabled = !enabled || !isRawKeyType(selectedKeyType());
  generateKeys.disabled = !enabled;
  copyPrivateKeys.disabled =
    !enabled || (!lastKeyBatch && lastPrivateBatch === undefined);
  copyBitcoinAddresses.disabled = !enabled || lastBitcoinBatch === undefined;
  copyEthereumAddresses.disabled = !enabled || lastEthereumBatch === undefined;
};

const selectedEncoding = (): OutputEncoding =>
  encodingInputs.find((input) => input.checked)?.value === "base64"
    ? "base64"
    : "hex";

const refreshPrivateOutput = () => {
  if (lastPrivateBatch !== undefined) {
    privateKeyOutput.value = lastPrivateBatch;
    return;
  }
  if (!lastKeyBatch) return;
  privateKeyOutput.value = formatKeyBatch(
    lastKeyBatch,
    lastKeyLength,
    selectedEncoding(),
  );
};

const clearKeys = () => {
  if (copyTimer !== undefined) window.clearTimeout(copyTimer);
  copyTimer = undefined;
  lastKeyBatch?.fill(0);
  lastKeyBatch = undefined;
  lastPrivateBatch = undefined;
  lastBitcoinBatch = undefined;
  lastEthereumBatch = undefined;
  lastKeyLength = 0;
  batchNumber = 0;
  privateKeyOutput.value = "";
  bitcoinAddressOutput.value = "";
  ethereumAddressOutput.value = "";
  outputMeta.textContent = "";
  privateCopyFeedback.textContent = "";
  bitcoinCopyFeedback.textContent = "";
  ethereumCopyFeedback.textContent = "";
};

const updateOutputLayout = () => {
  const type = selectedKeyType();
  const isMnemonic = isMnemonicKeyType(type);
  privateOutputLabel.textContent = isMnemonic
    ? "Seed phrases"
    : type === "bitcoin"
      ? "WIF private keys"
      : type === "ethereum"
        ? "Private keys"
        : "Generated keys";
  copyPrivateKeys.textContent = isMnemonic ? "Copy phrases" : "Copy private";
  privateKeyOutput.wrap = isMnemonic ? "soft" : "off";
  privateKeyOutput.classList.toggle("wrapped-output", isMnemonic);
  mnemonicPreviewSettings.hidden = !isMnemonic;
  bitcoinOutputLabel.textContent = isMnemonic
    ? `Bitcoin ${BITCOIN_PREVIEW_PATH}`
    : "P2WPKH addresses";
  ethereumOutputLabel.textContent = isMnemonic
    ? `Ethereum ${ETHEREUM_PREVIEW_PATH}`
    : "Ethereum addresses";
  bitcoinOutputArea.hidden = type !== "bitcoin" && !isMnemonic;
  ethereumOutputArea.hidden = type !== "ethereum" && !isMnemonic;
};

const clearGenerator = () => {
  generator?.dispose();
  generator = undefined;
  clearKeys();
};

const showIdle = () => {
  phase = "idle";
  showGenerationStage(false);
  setProgress(0);
  generateKeys.textContent = "Generate";
  cryptoStatus.textContent = "OS draw pending";
  showOverlay("Hit each target at variable precision and pace.", "Start");
  resetGame.disabled = true;
  setControlsEnabled(false);
};

const resetSession = () => {
  runToken += 1;
  if (scheduledFrame !== undefined) cancelAnimationFrame(scheduledFrame);
  scheduledFrame = undefined;
  clearGenerator();
  samples.length = 0;
  samples = [];
  currentTargetIndex = 0;
  keyboardMode = false;
  showIdle();
};

const scheduleTarget = (index: number, token: number) => {
  const position = targetPosition(index);
  target.hidden = true;
  target.style.setProperty("--target-x", `${position.x * 100}%`);
  target.style.setProperty("--target-y", `${position.y * 100}%`);
  target.setAttribute("aria-label", `Target ${index + 1} of ${TARGET_COUNT}`);

  scheduledFrame = requestAnimationFrame((timestamp) => {
    scheduledFrame = undefined;
    if (phase !== "collecting" || token !== runToken) return;
    targetShownAt = timestamp;
    target.hidden = false;
    if (keyboardMode) target.focus({ preventScroll: true });
  });
};

const failRun = (error: unknown, token: number) => {
  if (token !== runToken) return;
  console.error("Entropy generation failed", error);
  phase = "error";
  showGenerationStage(false);
  samples.length = 0;
  clearGenerator();
  cryptoStatus.textContent = "Web Crypto operation failed.";
  showOverlay(
    "This browser could not create the local generator.",
    "Try again",
  );
  setControlsEnabled(false);
};

const createKeyBatch = async (token: number) => {
  const activeGenerator = generator;
  if (!activeGenerator || token !== runToken) return;

  setControlsEnabled(false);
  generateKeys.textContent = "Generating...";
  try {
    const type = selectedKeyType();
    const count = Number.parseInt(keyCount.value, 10);
    let nextBatch: Uint8Array | undefined;
    let privateBatch: string | undefined;
    let bitcoinBatch: string | undefined;
    let ethereumBatch: string | undefined;
    let length = 0;

    if (isRawKeyType(type)) {
      length = type === "raw-128" ? 16 : 32;
      nextBatch = await activeGenerator.nextBytes(length * count);
      if (token !== runToken || generator !== activeGenerator) {
        nextBatch.fill(0);
        return;
      }
    } else if (isMnemonicKeyType(type)) {
      const wordCount: MnemonicWordCount = type === "bip39-12" ? 12 : 24;
      length = mnemonicEntropyLength(wordCount);
      const entropyBatch = await activeGenerator.nextBytes(length * count);
      const mnemonicBatch = await deriveMnemonicBatch(entropyBatch, wordCount, {
        isActive: () => token === runToken && generator === activeGenerator,
      });
      if (!mnemonicBatch) return;
      privateBatch = mnemonicBatch.phrases;
      bitcoinBatch = mnemonicBatch.bitcoinAddresses;
      ethereumBatch = mnemonicBatch.ethereumAddresses;
    } else {
      const keys: ChainKey[] = [];
      for (let index = 0; index < count; index += 1) {
        const secretKey = await nextSecp256k1SecretKey(activeGenerator);
        try {
          if (token !== runToken || generator !== activeGenerator) return;
          const key =
            type === "bitcoin"
              ? deriveBitcoinKey(secretKey)
              : deriveEthereumKey(secretKey);
          keys.push(key);
        } finally {
          secretKey.fill(0);
        }
      }
      if (token !== runToken || generator !== activeGenerator) return;
      const formatted = formatChainKeyBatch(keys);
      privateBatch = formatted.privateKeys;
      if (type === "bitcoin") bitcoinBatch = formatted.addresses;
      else ethereumBatch = formatted.addresses;
    }

    lastKeyBatch?.fill(0);
    lastKeyBatch = nextBatch;
    lastPrivateBatch = privateBatch;
    lastBitcoinBatch = bitcoinBatch;
    lastEthereumBatch = ethereumBatch;
    lastKeyLength = length;
    batchNumber += 1;
    refreshPrivateOutput();
    bitcoinAddressOutput.value = bitcoinBatch ?? "";
    ethereumAddressOutput.value = ethereumBatch ?? "";
    outputMeta.textContent = isRawKeyType(type)
      ? `${count} x ${length * 8}-bit keys / batch ${batchNumber}`
      : isMnemonicKeyType(type)
        ? `${count} x ${type === "bip39-12" ? 12 : 24}-word BIP-39 ${count === 1 ? "phrase" : "phrases"} / batch ${batchNumber}`
        : `${count} ${type === "bitcoin" ? "Bitcoin mainnet P2WPKH" : "Ethereum EOA"} ${count === 1 ? "key" : "keys"} / batch ${batchNumber}`;
    cryptoStatus.textContent = `HMAC counter: ${activeGenerator.blocksGenerated} blocks used`;
  } finally {
    if (token === runToken && phase === "ready") {
      generateKeys.textContent = "Generate";
      setControlsEnabled(true);
    }
  }
};

const finishCollection = async (token: number) => {
  phase = "deriving";
  cryptoStatus.textContent = "Hashing transcript, then drawing OS bytes";
  showOverlay("SHA-256 digest XOR 32 fresh OS bytes.");

  let transcript: Uint8Array | undefined;
  let seed: Uint8Array | undefined;
  try {
    transcript = encodeClickTranscript(samples);
    samples.length = 0;
    seed = await makeHybridSeed(transcript);
    if (token !== runToken) return;

    const nextGenerator = await HmacSha256Generator.create(seed);
    if (token !== runToken) {
      nextGenerator.dispose();
      return;
    }

    generator = nextGenerator;
    phase = "ready";
    cryptoStatus.textContent = "HMAC counter: 0 blocks used";
    showGenerationStage(true);
    resetGame.disabled = false;
    setControlsEnabled(true);
    if (keyboardMode) keyType.focus();
  } catch (error) {
    failRun(error, token);
  } finally {
    transcript?.fill(0);
    seed?.fill(0);
  }
};

const startCollection = (startedByKeyboard = false) => {
  if (
    !globalThis.crypto?.subtle ||
    typeof globalThis.crypto.getRandomValues !== "function"
  ) {
    failRun(new Error("Web Crypto is unavailable"), runToken);
    return;
  }

  runToken += 1;
  const token = runToken;
  if (scheduledFrame !== undefined) cancelAnimationFrame(scheduledFrame);
  scheduledFrame = undefined;
  clearGenerator();
  samples.length = 0;
  samples = [];
  currentTargetIndex = 0;
  keyboardMode = startedByKeyboard;
  phase = "collecting";
  showGenerationStage(false);
  arenaOverlay.hidden = true;
  resetGame.disabled = false;
  setProgress(0);
  setControlsEnabled(false);
  cryptoStatus.textContent = "OS draw pending";
  scheduleTarget(0, token);
};

const captureTarget = (
  clientX: number,
  clientY: number,
  pointerType: string,
) => {
  if (phase !== "collecting" || target.hidden) return;

  const receivedAt = performance.now();
  const bounds = target.getBoundingClientRect();
  target.hidden = true;
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;

  samples.push({
    targetNumber: currentTargetIndex + 1,
    reactionTimeMicroseconds: quantizeMicroseconds(receivedAt - targetShownAt),
    targetCenterX256: quantizeUnsignedFixed256(centerX),
    targetCenterY256: quantizeUnsignedFixed256(centerY),
    viewportWidth256: quantizeUnsignedFixed256(window.innerWidth),
    viewportHeight256: quantizeUnsignedFixed256(window.innerHeight),
    offsetX256: quantizeSignedFixed256(clientX - centerX),
    offsetY256: quantizeSignedFixed256(clientY - centerY),
    pointerType: pointerTypeCode(pointerType),
  });

  const count = samples.length;
  setProgress(count);
  cryptoStatus.textContent = "OS draw pending";
  if (count === TARGET_COUNT) {
    void finishCollection(runToken);
    return;
  }

  currentTargetIndex += 1;
  scheduleTarget(currentTargetIndex, runToken);
};

target.addEventListener("pointerdown", (event) => {
  if (!isPrimaryPointerActivation(event)) return;
  event.preventDefault();
  keyboardMode = false;
  captureTarget(event.clientX, event.clientY, event.pointerType);
});

target.addEventListener("keydown", (event) => {
  if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  keyboardMode = true;
  const bounds = target.getBoundingClientRect();
  captureTarget(
    bounds.left + bounds.width / 2,
    bounds.top + bounds.height / 2,
    "keyboard",
  );
});

startGame.addEventListener("click", (event) => {
  startCollection(event.detail === 0);
});
resetGame.addEventListener("click", resetSession);
generateKeys.addEventListener("click", () => {
  const token = runToken;
  void createKeyBatch(token).catch((error) => failRun(error, token));
});

for (const input of encodingInputs) {
  input.addEventListener("change", refreshPrivateOutput);
}

keyType.addEventListener("change", () => {
  clearKeys();
  updateOutputLayout();
  setControlsEnabled(phase === "ready");
});

const showCopyFeedback = (element: HTMLSpanElement, copy: string) => {
  privateCopyFeedback.textContent = "";
  bitcoinCopyFeedback.textContent = "";
  ethereumCopyFeedback.textContent = "";
  element.textContent = copy;
  if (copyTimer !== undefined) window.clearTimeout(copyTimer);
  copyTimer = window.setTimeout(() => {
    element.textContent = "";
    copyTimer = undefined;
  }, 1_800);
};

const copyOutput = async (
  output: HTMLTextAreaElement,
  feedback: HTMLSpanElement,
  privateCopyConfirmed = false,
) => {
  if (!output.value) return;
  let copied = false;
  try {
    await navigator.clipboard.writeText(output.value);
    copied = true;
  } catch {
    output.focus();
    output.select();
    privateCopyEventApproved = privateCopyConfirmed;
    try {
      copied = document.execCommand("copy");
    } finally {
      privateCopyEventApproved = false;
      output.setSelectionRange(0, 0);
    }
  }

  showCopyFeedback(feedback, copied ? "Copied" : "Copy unavailable");
};

const confirmPrivateCopy = (): boolean => window.confirm(PRIVATE_COPY_PROMPT);

bindCopyControls(
  {
    private: {
      button: copyPrivateKeys,
      output: privateKeyOutput,
      feedback: privateCopyFeedback,
    },
    bitcoin: {
      button: copyBitcoinAddresses,
      output: bitcoinAddressOutput,
      feedback: bitcoinCopyFeedback,
    },
    ethereum: {
      button: copyEthereumAddresses,
      output: ethereumAddressOutput,
      feedback: ethereumCopyFeedback,
    },
  },
  {
    confirmPrivateCopy,
    copy: copyOutput,
    isPrivateCopyApproved: () => privateCopyEventApproved,
    privateCopyCancelled: (feedback) =>
      showCopyFeedback(feedback, "Copy cancelled"),
  },
);

resetOnPageHide(window, resetSession);

updateOutputLayout();
showIdle();
