# Security policy

Entropy Mixer generates high-value secret material, so potential security
problems should be reported privately and handled with care.

## Supported versions

Security fixes are applied to the `main` branch and the latest published
release. Older releases may not receive fixes.

## Report a vulnerability

Use GitHub's private vulnerability reporting form:

<https://github.com/okcontract/entropy-mixer/security/advisories/new>

Please include:

- the affected commit or release;
- the browser and operating system used;
- a minimal reproduction or proof of concept;
- the expected and observed security properties; and
- any suggested mitigation.

Do not include real private keys, seed phrases, personal data, or other secrets.
Please do not open a public issue for a vulnerability until maintainers have had
a reasonable opportunity to investigate and coordinate a fix. Maintainers aim
to acknowledge a complete report within five business days.

Use a normal GitHub issue for non-sensitive bugs. If private vulnerability
reporting is not yet enabled on the repository, ask a repository maintainer for
a private reporting channel without disclosing the vulnerability itself.

## Scope and disclaimer

Reports about entropy collection, key derivation, secret retention, build
integrity, dependency compromise, or deployment policy are especially useful.
The project is experimental and has not received an independent security audit.
That disclaimer does not reduce the importance of responsibly reported issues.
