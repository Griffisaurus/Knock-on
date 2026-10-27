# KNOCK-ON

*Every action has an overreaction.*

A WebGPU 3D chain-reaction sandbox for one or two players, inspired by classic machine-building puzzle games.

> **Status (2026-10-25):** the feature-complete sandbox beta (M5) is built on Chrome: all 110 catalogue rows of parts (M1–M5), 8 critters including BUZZ, six environments (the Studio, Tinker Lab, Mega Kitchen, Backlot, Orbital Hangar and Moon Base), 2-player co-op, the deterministic Matter layer with sand, water, marbles and goo, global wind, capture with sound and the Glass Lab UI. Status: [docs/dev/M5_STATUS.md](docs/dev/M5_STATUS.md) and [docs/PRODUCTION.md §0](docs/PRODUCTION.md).

![THE TINKER LAB key art](art/style-samples/tinker_lab_key.png)

*THE TINKER LAB, the default world for Desk and Room ([D77–D79](docs/dev/DECISIONS_2026-10-24.md): glass UI, "science class maximalism", warm renderer look).*

## Docs

Full index: **[docs/README.md](docs/README.md)**.

| Doc | For | What's in it |
|---|---|---|
| [GAME_SPEC.md](GAME_SPEC.md) | Everyone | Vision, 3D deterministic sim, world scale and VRAM budget, UI and art direction, ~115 parts, milestones |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [SIMULATION](docs/SIMULATION.md) · [RENDERING](docs/RENDERING.md) · [PART_SYSTEM](docs/PART_SYSTEM.md) · [DATA_FORMATS](docs/DATA_FORMATS.md) · [ENGINEERING](docs/ENGINEERING.md) | Engineers | How it's built |
| [docs/MULTIPLAYER.md](docs/MULTIPLAYER.md) · [LOCAL_DEVELOPMENT](docs/LOCAL_DEVELOPMENT.md) | Engineers | 2-player co-op architecture and loopback-only local setup |
| [docs/art/ART_BIBLE.md](docs/art/ART_BIBLE.md) · [ASSET_PIPELINE](docs/art/ASSET_PIPELINE.md) · [briefs/](docs/art/briefs/README.md) | Artists | Look, Blender conventions, per-asset briefs |
| [docs/UI_UX.md](docs/UI_UX.md) · [AUDIO](docs/AUDIO.md) | Design, audio | Screens, tokens, sound design |
| [docs/PRODUCTION.md](docs/PRODUCTION.md) | Producer | Milestone status, epics, asset schedule |
| [docs/HOW_TO_PLAY.md](docs/HOW_TO_PLAY.md) | Players | Manual |
| [reference/tim1/README.md](reference/tim1/README.md) | Research | Decoded 1993 data (reference only, never shipped) |

## Run locally

Install Node.js 22+, pnpm 9.15.9, Git LFS and Blender 4.4+.

```bash
git lfs pull
pnpm install
```

Generated runtime assets are intentionally not committed. Build them from the included Blender sources on a fresh clone (this can take a while):

```bash
pnpm assets
pnpm assets -- --props --env-kitchen --env-tinker --env-backlot --env-hangar --env-moon
```

```bash
pnpm build
```

```bash
pnpm host
```

Open `http://localhost:8787`. A second browser tab can be used to exercise two-player behavior on the same computer. See [local development](docs/LOCAL_DEVELOPMENT.md).

## Art

Look-dev renders live in [`art/style-samples/`](art/style-samples/):

- **Tinker Lab key art:** `tinker_lab_key.png` (hero, 1920 × 1080) and `tinker_lab_lobby.png` (shallow-focus lobby and title backdrop), built from the exported part glbs by [`tools/blender/render_tinker_lab.py`](tools/blender/render_tinker_lab.py). It settles every part onto its support and checks for overlaps (`--check` reports, `--strict` fails on any).
- **Part icons:** `icons/` holds 28 warm, tactile 3D part icons (256², `.thumb.webp`) from [`tools/blender/render_thumbs.py`](tools/blender/render_thumbs.py) (`--warm` Tinker Lab light, `--tactile` the look-dev surfaces of [`tools/blender/_tactile.py`](tools/blender/_tactile.py)).
- **Lineup and material studies** (`knockon_lineup.png` and friends) from [`tools/blender/style_samples.py`](tools/blender/style_samples.py), plus per-part export renders and contact sheets ([docs/art/PIPELINE_STATUS.md](docs/art/PIPELINE_STATUS.md)).

Re-render with Blender 4.4+:

```bash
blender -b --factory-startup -P tools/blender/render_tinker_lab.py -- art/style-samples/tinker_lab_key.png --view hero --strict
```

```bash
blender -b --factory-startup -P tools/blender/render_thumbs.py -- art/style-samples/icons --warm --tactile --size 256
```

```bash
blender -b --factory-startup --python tools/blender/style_samples.py -- art/style-samples assets/src/style-samples final
```

## Repo map

```
GAME_SPEC.md            the game design + technical spec
docs/                   engineering, art, UI, audio and production docs; multiplayer, local setup, player manual
art/style-samples/      look-dev renders
assets/src/             Blender sources
tools/blender/          Blender scripts (parts, export/validate, key art, thumbnails, style samples)
tools/tim1-extract/     1993 data extractor (reference only)
reference/tim1/         local-only reference data (excluded from version control)
```

## License

Original KNOCK-ON code and assets are available under the [MIT License](LICENSE). Bundled third-party components retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).

KNOCK-ON is inspired by the 1993 game *The Incredible Machine*.
