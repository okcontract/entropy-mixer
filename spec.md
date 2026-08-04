# Entropy Mixer Design Document

<!-- Note: This project was built with AI assistance, but under human supervision. -->

Clicks can supply **fresh entropy**. A PRNG is the deterministic component that expands a fixed-size seed. A sound browser construction separates those two layers:

$$
\text{human measurements} \longrightarrow \text{conditioner} \longrightarrow \text{seed} \longrightarrow \text{CSPRNG}
$$

A static HTML/JavaScript page can perform all of this locally. The defensible result is a **hybrid CSPRNG**. The claim that it is more random than an ideal 256-bit machine-generated value is mathematically incorrect, since an ideal 256-bit value already has the maximum possible 256 bits of entropy.

## Recommended construction

For each of 16 targets, record an ordered sample such as

$$
Z_i=(t_i,\Delta x_i,\Delta y_i)
$$

where:

* $t_i$ is the quantized elapsed time between displaying the target and receiving `pointerdown`.
* $(\Delta x_i,\Delta y_i)$ are the quantized offsets between the click and target center.
* The target number, target location, viewport dimensions and pointer type are included as public context.

The target location should be treated as known to an attacker. Its purpose is to elicit motor variation. It does not itself contribute human entropy.

Use a deterministic, public target sequence when measuring the human entropy source. Randomizing the targets with `crypto.getRandomValues()` is also reasonable, though that randomness belongs to the machine source and should be counted separately.

After the 16 clicks:

1. Canonically encode every sample using fixed-width integers.
2. Hash the complete ordered transcript with SHA-256.
3. Obtain 32 fresh bytes from `crypto.getRandomValues()` after click collection.
4. XOR the two 32-byte values.
5. Use the result as the key for HMAC-SHA-256 with a monotonically increasing counter, or seed a reviewed DRBG construction.

The browser-facing machine generator should be `crypto.getRandomValues()`. The Web Crypto specification requires cryptographically strong bytes, recommends well-established CSPRNGs seeded from operating-system entropy, and explicitly supplies no information-theoretic lower bound for actual implementations. `Math.random()` is only approximately uniform and uses an implementation-defined strategy, so it is the wrong comparator for cryptographic randomness. ([W3C][1])

A compact version of the seed construction is:

```js
async function makeHybridSeed(clickTranscriptBytes) {
  if (!(clickTranscriptBytes instanceof Uint8Array)) {
    throw new TypeError("Expected a Uint8Array");
  }

  // Condition the entire click transcript.
  const clickDigest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", clickTranscriptBytes)
  );

  // Draw this after click collection to simplify the independence model.
  const osRandom = crypto.getRandomValues(new Uint8Array(32));

  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    seed[i] = osRandom[i] ^ clickDigest[i];
  }

  // Best-effort cleanup of temporary byte arrays.
  osRandom.fill(0);
  clickDigest.fill(0);

  return seed;
}
```

The transcript should use something like:

```text
version || sampleCount ||
reactionTimeMicroseconds[0] || dxFixedPoint[0] || dyFixedPoint[0] ||
reactionTimeMicroseconds[1] || dxFixedPoint[1] || dyFixedPoint[1] ||
...
```

Use fixed-width big-endian integers. Avoid summing, averaging, multiplying or taking only the low timestamp bits. Those operations tend to preserve bias and discard information.

For deterministic expansion:

$$
B_j=\operatorname{HMAC\mbox{-}SHA256}
(K,\text{"whack-rng-v1"}\mathbin\Vert\operatorname{uint64}(j))
$$

where $K$ is the hybrid seed and each counter value is used once. Bounded integers should be produced with rejection sampling rather than `value % n`, which can introduce modulo bias.

## BIP-39 mnemonic encoding

A 12-word phrase consumes 16 generator bytes as 128 bits of BIP-39 entropy. A
24-word phrase consumes 32 bytes as 256 bits of entropy. For each phrase,
BIP-39 appends the first `ENT / 32` bits of `SHA256(entropy)`, splits the result
into 11-bit indexes, and maps those indexes through the standard English
2048-word list.

English is used because the
[BIP-39 specification](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki)
identifies it as the wordlist supported by the majority of BIP-39 wallets.
Each phrase consumes the next bytes from the continuous HMAC stream.

During import, a wallet converts the mnemonic and optional BIP-39 passphrase
into a 512-bit seed, then applies its own BIP-32 or related derivation paths.
The derivation path determines the accounts and addresses shown by that wallet.

For each generated phrase, the app derives two public previews using an empty
BIP-39 passphrase:

* Bitcoin mainnet P2WPKH at `m/84'/0'/0'/0/0`, the first receiving address in
  account zero under [BIP-84](https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki).
* Ethereum at `m/44'/60'/0'/0/0`, the first address in account zero using the
  registered Ethereum coin type.

Each address row corresponds to the phrase on the same row. Address derivation
consumes no additional HMAC output. A different BIP-39 passphrase or derivation
path produces different addresses.

## Chain key derivation

Bitcoin and Ethereum EOA keys consume 32-byte generator candidates. Interpret
each candidate as a big-endian integer $d$ and accept it only when
`1 <= d < n`, where $n$ is the secp256k1 group order. Reject an invalid
candidate and consume the next 32 generator bytes. Do not reduce it modulo $n$.

For Bitcoin mainnet P2WPKH, derive the compressed secp256k1 public key, compute
`RIPEMD160(SHA256(publicKey))`, and encode the version-zero witness program with
Bech32. Export the private key as compressed WIF using
`0x80 || privateKey || 0x01` and Base58Check.

For an Ethereum EOA, derive the uncompressed secp256k1 public key, remove its
`0x04` prefix, hash the remaining 64 bytes with Keccak-256, and take the final
20 bytes as the address. Display the address with the ERC-55 checksum.

The generated chain keys are independent counter-stream outputs. They are not a
BIP-32 hierarchy and each private key requires its own backup.

## Exact proof when the machine reading is ideal

Let:

* $C$ be the click transcript.
* $D=H(C)$ be any deterministic 256-bit function of it.
* $R$ be an independent, perfectly uniform 256-bit machine value.
* $S=R\oplus D$.

For every possible 256-bit output $s$,

$$
\begin{aligned}
\Pr[S=s]
&=\sum_c \Pr[C=c]\Pr[R=s\oplus H(c)\mid C=c] \\
&=\sum_c \Pr[C=c] \, 2^{-256} \\
&=2^{-256}.
\end{aligned}
$$

Therefore $S$ is exactly uniform, regardless of how biased or predictable the clicks are.

This proves three useful properties:

1. **The click source cannot degrade an independent perfect machine source.**
2. **The result cannot become more uniform than the machine source**, since exact uniformity is already the mathematical optimum.
3. **The clicks can provide failure resilience** when the machine generator malfunctions in a way that remains independent of the clicks.

A related result applies when $R$ is only approximately uniform. If its statistical distance from uniform is $\delta$, XOR with an independent click-derived value satisfies

$$
\Delta(R\oplus D,U_{256})\leq \delta.
$$

Random independent XOR acts as a statistical channel and cannot increase that distance.

The independence condition matters. An adversarial source that sees $D$ before selecting $R$ could choose $R=D$, producing an all-zero seed. Sampling the machine value after the clicks supports the intended model, though a fully malicious browser or operating system controls the whole execution environment and defeats any in-page assurance.

## How much entropy do the clicks contain?

The number of timestamp digits or possible coordinates gives only an upper bound. Cryptographic analysis normally uses **min-entropy**:

$$
H_\infty(X)=-\log_2\left(\max_x \Pr[X=x]\right).
$$

Suppose that, for every prior click history and all attacker knowledge $E$,

$$
\max_z
\Pr[Z_i=z\mid Z_1,\ldots,Z_{i-1},E]
\leq 2^{-h_i}.
$$

Then the complete 16-click transcript has the lower bound

$$
H_\infty(Z_1,\ldots,Z_{16}\mid E)
\geq \sum_{i=1}^{16}h_i.
$$

For example:

* A validated bound of 2 bits per click gives at least 32 bits.
* A validated bound of 4 bits per click gives at least 64 bits.
* A validated bound of 8 bits per click gives at least 128 bits.

Those are hypothetical entropy rates. They cannot be inferred from 16 clicks. They require a large validation dataset, an explicit attacker model, conservative binning, dependence analysis and confidence bounds.

Reaction time and positional error should be estimated jointly. Adding separate entropy estimates for time, $x$, and $y$ can count the same uncertainty more than once because those measurements are correlated.

NIST treats min-entropy as a worst-case unpredictability measure and explicitly states that a deterministic conditioning function can produce at most the entropy present in its input. Hashing a 64-bit-entropy transcript into 256 bits still leaves at most 64 bits of source entropy, even when the digest passes every statistical randomness test. ([NIST SP 800-90B][2])

## What “near perfect” would require

For an information-theoretic statement, consider a seeded universal hash extractor. A common form of the leftover hash lemma gives

$$
\Delta(\operatorname{Ext}(X),U_m)
\leq \frac12\sqrt{2^{m-k}},
$$

where $k$ is the transcript's min-entropy and $m$ is the extracted output length.

For a 256-bit output whose statistical distance from uniform is at most $2^{-64}$:

$$
\frac12\sqrt{2^{256-k}}\leq 2^{-64}.
$$

Solving gives

$$
k \geq 382\text{ bits}.
$$

With 16 clicks, that requires almost 24 bits of proven conditional min-entropy per click. Timestamp precision alone does not establish such a bound.

For a 128-bit output within $2^{-32}$ of uniform, the same formula requires approximately 190 bits total, or about 12 proven bits per click.

SHA-256 is a practical cryptographic conditioner, though a mathematical extractor proof for arbitrary weak sources requires a properly selected universal hash family and an independent public extractor seed. Treating SHA-256 as an extractor introduces a cryptographic assumption.

## What can be claimed

A well-designed whack-a-mole page can support this statement:

> Under the assumption that the operating-system CSPRNG output is independent of the click transcript, XORing it with a SHA-256 digest of that transcript preserves the security and uniformity of the operating-system source. If the operating-system source fails benignly, any validated unpredictability in the click source remains available as supplemental security.

It cannot support this statement without extensive entropy-source validation:

> Sixteen clicks produce a provably uniform 256-bit secret.

Compared with one 256-bit call to `crypto.getRandomValues()`, the hybrid construction provides a stronger **failure-diversity argument**. It provides no greater statistical uniformity when that machine call is already ideal. Compared with one `Math.random()` result, the hybrid construction is substantially more suitable for security because `Math.random()` has no cryptographic guarantee.

[1]: https://www.w3.org/TR/webcrypto-2/ "Web Cryptography Level 2"
[2]: https://doi.org/10.6028/NIST.SP.800-90B "NIST SP 800-90B: Recommendation for the Entropy Sources Used for Random Bit Generation"
