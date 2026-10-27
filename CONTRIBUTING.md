# Contributing

Thanks for helping improve KNOCK-ON.

## Development setup

1. Install Node.js 22 or newer and pnpm 9.15.9.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` before opening a pull request.

See [`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md) for the loopback-only browser setup.

## Repository hygiene

- Do not commit credentials, access tokens, private URLs, hostnames, IP addresses, saved worlds, local configuration, or machine-specific paths.
- Do not add the original 1993 game archive or any decoded reference material.
- Keep generated build output and playtest recordings out of commits.
- Preserve third-party attribution and license files when changing bundled dependencies or assets.

By contributing, you agree that your contributions will be licensed under the repository's MIT License.
