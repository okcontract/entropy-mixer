# Entropy Mixer

[![CI](https://github.com/okcontract/entropy-mixer/actions/workflows/ci.yml/badge.svg)](https://github.com/okcontract/entropy-mixer/actions/workflows/ci.yml)

A small, inspectable browser app for generating raw keys, BIP-39 seed phrases,
and Bitcoin or Ethereum private keys from a hybrid entropy source.

Browsers already provide an operating-system-backed CSPRNG through
`crypto.getRandomValues()`. Entropy Mixer keeps that as the security baseline
and adds a separately collected human interaction transcript. The result is a
minimal secret generator with an explicit construction, fixed output formats,
and deterministic tests.

> [!CAUTION]
> This project is experimental and has not received an independent security
> audit. Do not use it for meaningful funds. Review the source and verify its
> output with an independent offline implementation.

## Why this exists

This app provides entropy source diversity by doing the following:

- It draws 32 fresh bytes from the browser CSPRNG after interaction collection.
- It canonically encodes and hashes a complete ordered pointer transcript from
  a target game.
- It combines both sources while preserving an independent, uniform OS sample
  even when clicks are predictable.
- It expands one seed into a continuous, domain-separated HMAC-SHA-256 stream.
- It encodes 12-word and 24-word English BIP-39 mnemonic phrases.
- It previews the first standard Bitcoin and Ethereum address for each phrase.
- It derives correctly encoded secp256k1 keys for Bitcoin and Ethereum.

## Outputs

| Mode | Private output | Public output |
| --- | --- | --- |
| Raw 128-bit | Hex or Base64 | None |
| Raw 256-bit | Hex or Base64 | None |
| BIP-39 12-word | English mnemonic | First Bitcoin and Ethereum addresses |
| BIP-39 24-word | English mnemonic | First Bitcoin and Ethereum addresses |
| Bitcoin | Compressed mainnet WIF | Native SegWit P2WPKH address (`bc1...`) |
| Ethereum | 32-byte `0x`-prefixed key | ERC-55 checksummed EOA address |

Each batch contains 1, 4, or 8 independent outputs. Seed phrases wrap within
their rows. Their Bitcoin and Ethereum address rows use the same order. Direct
Bitcoin and Ethereum private keys and addresses also use corresponding rows.

Every generated secret consumes fresh bytes from the counter stream and
requires its own backup.

## How it works

```text
16 ordered pointer samples -> canonical bytes -> SHA-256 ---\
                                                           XOR -> 32-byte seed
crypto.getRandomValues(32 bytes), drawn after the clicks ---/

32-byte seed -> HMAC-SHA-256("whack-rng-v1" || uint64(counter)) -> key bytes
```

For each target, the transcript records:

- target number;
- reaction time in quantized microseconds;
- target center and viewport dimensions in fixed-point coordinates;
- pointer offset from the target center;
- pointer type.

The fixed, public target sequence provides measurement context. Mouse, pen, and
primary touch contacts use the same Pointer Events path. Mobile devices use the
same Web Crypto CSPRNG baseline as desktop browsers.

After the 16th sample, the app:

1. Encodes the complete transcript using fixed-width, big-endian integers.
2. Computes `SHA-256(transcript)` with Web Crypto.
3. Draws 32 bytes with `crypto.getRandomValues()`.
4. XORs the digest and OS bytes to form a 32-byte seed.
5. Imports that seed as a non-extractable Web Crypto HMAC-SHA-256 key.
6. Generates counter blocks starting at zero under the `whack-rng-v1` domain.

The detailed encoding, proof, and entropy analysis are in
[`spec.md`](./spec.md).

### Seed phrases

The BIP-39 modes encode 128 entropy bits as 12 English words or 256 entropy bits
as 24 English words. The checksum and 2048-word mapping follow
[BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki), whose
specification identifies English as the wordlist supported by most BIP-39
wallets.

On import, the wallet converts the phrase and optional BIP-39 passphrase into a
512-bit seed, then applies its account derivation paths. An optional passphrase
selects a different wallet and requires a separate backup.

For each phrase, the app previews these addresses using an empty BIP-39
passphrase:

- Bitcoin mainnet Native SegWit
  ([BIP-84](https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki)):
  `m/84'/0'/0'/0/0`;
- Ethereum: `m/44'/60'/0'/0/0`.

These are the first addresses for the listed paths. Each address row corresponds
to the phrase on the same row. Importing with another passphrase or a wallet
using another path produces different addresses.

### Chain key derivation

Bitcoin and Ethereum EOA keys use secp256k1. Each 32-byte stream candidate is
interpreted as a big-endian integer `d` and accepted only when `1 <= d < n`,
where `n` is the secp256k1 group order. Invalid candidates are discarded and the
next 32 stream bytes are used.

Bitcoin derivation:

1. Derive the compressed secp256k1 public key.
2. Compute `RIPEMD160(SHA256(publicKey))`.
3. Encode that 20-byte witness program as a version-zero mainnet
   [Bech32 P2WPKH address](https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki).
4. Encode `0x80 || privateKey || 0x01` with Base58Check as compressed mainnet
   WIF.

Ethereum derivation:

1. Derive the uncompressed secp256k1 public key.
2. Remove its `0x04` prefix.
3. Compute Keccak-256 and take the final 20 bytes.
4. Apply the [ERC-55 checksum](https://eips.ethereum.org/EIPS/eip-55).

## Use it safely

1. Build and verify the app on a trusted machine.
2. Serve the static files on `localhost` or over HTTPS so Web Crypto runs in a
   secure context.
3. Open the app in a clean guest browser profile. Let all static assets load,
   then disconnect from the Internet before generating valuable keys.
4. Select **Start** and hit all 16 targets. The full-width panel then switches
   to generation.
5. Choose an output type, count, and, for raw keys, an encoding.
6. Select **Generate**. Each generation continues the current HMAC stream.
7. Verify public addresses with a second offline implementation before sending
   funds.
8. Back up every private key or seed phrase, reset the app, and close the guest
   session.

Keep generated secrets offline. The app asks for confirmation before copying
private material, while public addresses have a separate copy
action. Clipboard managers, browser extensions, screen capture, and shell
history can still retain secrets outside the app.

The `HMAC counter` status reports how many 32-byte generator blocks the current
session has consumed. Resetting and completing a new 16-target run creates a new
seed.

## Build and run

Requirements:

- [Bun](https://bun.sh/) 1.3.14, matching the repository and CI toolchain;
- a modern browser with Web Crypto and ES module support.

Install the committed dependency graph from the repository root:

```sh
bun install --frozen-lockfile
```

Then run the app from the same repository root:

```sh
bun run dev
```

Open the local URL printed by Bun.

For a production bundle:

```sh
bun run build
python3 -m http.server 8080 --directory dist
```

Open `http://localhost:8080`. The `dist/` directory is a complete static site.
The development CSP permits Bun's hot-reload WebSocket. Each production build
replaces `dist/` with one HTML file, one script, one stylesheet, one SVG logo,
`LICENSE`, `TRADEMARKS.md`, and `_headers`, and changes the HTML policy to
`connect-src 'none'`.

The headers add framing, MIME-sniffing, and cross-origin isolation defenses on
static hosts that honor the `_headers` format. Other hosts must be configured
with equivalent response headers. A CSP meta element cannot enforce
`frame-ancestors`, so response headers are required for framing protection.

After deployment, verify the live response rather than assuming the host used
the checked-in header file:

```sh
bun run verify:deployment -- https://your-production-url.example/
```

For an offline transfer, produce and verify a sorted checksum manifest:

```sh
bun run release:checksums
cd dist
shasum -a 256 -c SHA256SUMS
```

## Verify the implementation

Run the complete package gate:

```sh
bun run check
```

It runs, in order:

1. Biome linting.
2. Strict TypeScript type checking.
3. The complete Bun test suite.
4. A minified browser production build.

Run the browser-level release gate after installing Playwright's browsers once:

```sh
bun run test:e2e:install
bun run check:release
```

That exercises the production bundle in Chromium, Firefox, and WebKit,
including pointer and keyboard collection, every output mode, reset, private
copy cancellation, and the absence of cross-origin runtime requests. GitHub CI
runs the same browser projects independently.

Also run the registry advisory scan and reproducibility check before a release:

```sh
bun run audit
bun run verify:reproducible-build
```

Target the cryptographic tests directly when reviewing changes:

```sh
bun test src/entropy.test.ts
bun test src/mnemonic.test.ts
bun test src/chain.test.ts
```

The tests verify:

- canonical, ordered, fixed-width transcript encoding;
- SHA-256 before the OS draw and byte-for-byte XOR mixing;
- the HMAC domain, big-endian counter, continuous stream, and disposal behavior;
- official 12-word and 24-word English BIP-39 vectors, HD address paths,
  multi-phrase row alignment, and reset invalidation;
- the exact secp256k1 scalar range and rejection of invalid candidates;
- compressed Bitcoin WIF and BIP-173 address derivation;
- Ethereum public-key hashing and ERC-55 checksumming;
- public target positions and raw-key encodings;
- native and button private-output confirmation, public copy routing, and
  output wrapping;
- development-to-production CSP transformation and the exact build artifact.

The Playwright suite additionally exercises `src/main.ts` against a served,
minified production build rather than a mocked DOM.

The public scalar `1` is used as a deterministic chain vector:

| Output | Expected value |
| --- | --- |
| Bitcoin WIF | `KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn` |
| Bitcoin P2WPKH | `bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4` |
| Ethereum EOA | `0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf` |

Scalar `1` is public test data reserved for verification.

### Review order

The smallest useful audit path is:

1. [`spec.md`](./spec.md): construction, assumptions, and entropy claims.
2. [`src/entropy.ts`](./src/entropy.ts): transcript encoding, mixing, and HMAC
   stream.
3. [`src/mnemonic.ts`](./src/mnemonic.ts): BIP-39 encoding and HD address
   previews.
4. [`src/chain.ts`](./src/chain.ts): scalar validation and address encodings.
5. The corresponding `*.test.ts` files: deterministic behavior and vectors.
6. [`package.json`](./package.json) and the repository
   [`bun.lock`](./bun.lock): dependency versions and resolved integrity
   metadata.
7. [`build.ts`](./build.ts): production policy and clean artifact replacement.

## Security model and limitations

The construction assumes:

- the loaded code matches the reviewed source;
- the browser and operating system are trustworthy;
- `crypto.getRandomValues()` behaves as a CSPRNG;
- the OS sample is independent of the completed click transcript.

Under those assumptions, XOR preserves the uniformity of an ideal OS sample
even with predictable clicks. During an independent, benign OS generator
failure, genuine unpredictability in the click transcript may still provide
useful resilience. That contribution remains unquantified.

Operational risks include:

- a malicious or compromised browser, operating system, dependency, or build;
- a machine entropy source chosen adversarially after observing the click
  digest;
- extensions, keyloggers, screen capture, clipboard history, or physical
  observation;
- loss, theft, or incorrect backup of generated secrets;
- accidental use of the wrong network, address type, passphrase, or derivation
  path.

All runtime cryptography is local. Static dependencies are bundled, and
application state remains in memory. Reset performs best-effort cleanup: it
drops application references and overwrites byte arrays the app controls.
Immutable strings and dependency- or browser-managed intermediate buffers may
remain until reclaimed. An in-flight Web Crypto operation cannot be canceled by
the app; any result arriving after Reset is discarded.

Navigating away invalidates pending generation work and runs the same cleanup
before the page can enter the browser's back-forward cache. Treat browser
memory, copied strings, and clipboard contents as potentially persistent.

## Dependencies

The direct third-party runtime packages are pinned exactly:

- [`@noble/curves@2.2.0`](https://github.com/paulmillr/noble-curves) for
  secp256k1;
- [`@noble/hashes@2.2.0`](https://github.com/paulmillr/noble-hashes) for
  SHA-256, RIPEMD-160, and Keccak-256;
- [`@scure/bip32@2.2.0`](https://github.com/paulmillr/scure-bip32) for HD key
  derivation;
- [`@scure/bip39@2.2.0`](https://github.com/paulmillr/scure-bip39) for BIP-39
  encoding and the English wordlist.

Hybrid seed hashing and HMAC expansion use the browser's Web Crypto API.
Base58Check and Bech32 encoding are implemented locally to keep the dependency
surface small. The Scure packages use the same pinned Noble packages and
`@scure/base@2.2.0`. Their MIT license notices are retained in the source and
built HTML.

The lockfile also pins development tooling. Dependabot is configured for Bun
and GitHub Actions updates, while CI runs `bun audit` against the committed
dependency graph. Advisory scans are time-dependent and complement rather than
replace source review.

## Security reports and releases

Report suspected vulnerabilities privately as described in
[`SECURITY.md`](./SECURITY.md). Do not include real keys or seed phrases in a
report.

The tag workflow verifies the complete release gate, checks that consecutive
builds are byte-identical, writes SHA-256 manifests, packages a deterministic
archive, and records GitHub artifact provenance. The maintainer checklist and
verification commands are in [`RELEASING.md`](./RELEASING.md).

## License

The source code and documentation are [MIT licensed](./LICENSE), Copyright (c)
2026 OKcontract Pte. Ltd. The OKcontract name and logo are governed by the
limited redistribution permission and [trademark policy](./TRADEMARKS.md):
modified forks must replace the logo and remove OKcontract branding unless they
have separate permission. Bundled third-party code remains subject to its own
license notices.
