# Local development

KNOCK-ON's development server is intentionally bound to the loopback interface by default. These instructions run the game only on the current computer.

## Requirements

- Node.js 22 or newer
- pnpm 9.15.9
- Git LFS
- Blender 4.4 or newer when generating runtime assets
- A desktop browser with WebGPU support

## Run the game

```bash
git lfs pull
pnpm install
pnpm assets
pnpm assets -- --props --env-kitchen --env-tinker --env-backlot --env-hangar --env-moon
pnpm build
pnpm host
```

The two asset commands generate ignored runtime files from the included source assets. They are required on a fresh clone and can take a while.

Open `http://localhost:8787` in the browser. Open a second tab to exercise two-player behavior locally.

Runtime worlds, journals, and backups are stored under `data/`, which is excluded from version control.

## Configuration

The checked-in defaults are safe for local development:

```json
{
  "port": 8787,
  "dataDir": "./data",
  "staticDir": "./apps/game/dist"
}
```

Put local overrides in `host.config.local.json`; the file is ignored by Git. Do not commit credentials, local test servernames, public URLs, or machine-specific paths.

The server address is hard-coded to `127.0.0.1`; configuration cannot publish it outside the local computer.
