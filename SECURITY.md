# Security Policy

AppBuilder handles accounts, customer websites, contact-form messages and credit balances, so we take security
seriously. Thank you for helping keep the project and its users safe.

## Supported versions

The project is in early development. Security fixes are made on the `main` branch only.

## Reporting a vulnerability

**Please do not report security vulnerabilities in public issues, discussions or pull requests.**

Instead, report them privately via GitHub:
**[Report a vulnerability](https://github.com/BailinZheng/appbuilder/security/advisories/new)**
(repository → *Security* → *Report a vulnerability*).

Please include:

- a description of the issue and its impact
- steps to reproduce or a proof of concept
- affected files, routes or versions, if known

You can expect an acknowledgement within a few days. We will keep you informed about the fix and, if you wish,
credit you in the release notes once the issue is resolved.

## Scope

Examples of issues we are especially interested in:

- authentication or session flaws, and access to other users' apps, messages or media (tenant isolation)
- ways to spend, create or duplicate credits without paying, or to bypass hosting checks
- XSS, injection, SSRF or path traversal (e.g. via site content, uploads or reference URLs)
- leaks of personal data or secrets

The developer tools (`ENABLE_DEV_TOOLS=true`) are intentionally powerful and must never be enabled on a public
server; issues that only exist with dev tools enabled are out of scope.
