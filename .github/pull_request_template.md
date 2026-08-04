## Summary

Describe the change and its user-visible or security impact.

## Verification

- [ ] `bun run check` passes.
- [ ] Browser-facing changes pass `bun run test:e2e`.
- [ ] Cryptographic or secret-handling changes include deterministic vectors and updated design documentation.
- [ ] No real private key, seed phrase, personal data, or other secret is included.
- [ ] Production CSP and response-header protections are not weakened.
