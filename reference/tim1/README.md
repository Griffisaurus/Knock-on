# TIM 1 reference data (do not ship)

Extracted from `The-Incredible-Machine_DOS_EN.zip` (Sierra/Dynamix, 1993) with
`tools/tim1-extract/tim1_extract.py`. Use it to study the original's design: part list, sprite sizes,
animation frame counts, level goals and physics settings.

**Nothing in this folder may ship in the game or be traced into new art.** The name "The Incredible Machine", its
characters (Pokey, Mort, Bob, Kelly) and all sprites, sounds and levels belong to their rights holder.

| Path | Contents |
|---|---|
| `raw/` | Every resource unpacked from RESOURCE.001–004, unmodified |
| `sprites/*.png` | Decoded sprite sheets (all frames, 2x scale, transparent background) |
| `sprites/frames.json` | Frame sizes per sheet |
| `levels.json` | Title, goal text, bonus values, gravity and air pressure for all 87 puzzles |
| `palette.json` | The 16-colour TIM.PAL palette |

The sprite colours use TIM.PAL directly, but some sprites look off (blue cat, blue balloon), so the game probably
remaps colours at runtime in a way we haven't decoded yet. Treat the colours as approximate.
