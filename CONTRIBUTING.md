# Contributing

Thank you for helping improve Entropy Mixer. Security, correctness, and
reviewability take priority over adding features.

## Set up the project

Install Bun 1.3.14 and the exact committed dependency graph:

```sh
bun install --frozen-lockfile
bun run check
```

For browser-level changes, install the Playwright browsers once and run the
cross-browser suite:

```sh
bun run test:e2e:install
bun run test:e2e
```

Run `bun run format` before submitting a change, then rerun `bun run check`.

## Changes to cryptographic behavior

A change to entropy collection, conditioning, expansion, mnemonic encoding,
key derivation, address encoding, lifecycle cleanup, or dependency versions
must include:

- a clear security rationale and updated design documentation;
- deterministic tests, preferably against an official or independently
  implemented vector;
- tests for failure and boundary cases; and
- no weakening of the production content security or response-header policy.

Never put a real private key or seed phrase in an issue, test, screenshot, log,
or pull request. Public test vectors must be identified as such.

## Pull requests

Keep changes focused and explain their user-visible and security impact. By
submitting a contribution, you confirm that you have the right to submit it and
agree that it is licensed under the repository's MIT License. The OKcontract
name and logo remain subject to [the trademark policy](./TRADEMARKS.md).

Report suspected vulnerabilities through [the security process](./SECURITY.md), 
not a public issue.
