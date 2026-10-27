# THE LONG WAY HOME: build log

Status: **finished**. The whole machine is built through the UI and runs end to end in the browser: a hero BOING is carried about 40 m from a shelf above BISCUIT to a beacon pad, through four acts, and the clock (HOURGLASS 120 s) ends in a boom and the singularity. The film is `long_way_home.mp4`.

This replaces the 12:29 first-attempt log. The first design (a bouncy ball hopped along by boosters) could not carry a 0.6 kg BOING; the second design is built around energy, as the coordinator suggested, and works.

## Deliverables (this folder)
| File | What |
|---|---|
| `long_way_home.mp4` | 1920x1080, H.264 CRF 23, AAC, 30 fps, **2 min 14.6 s**, 25.8 MB. Title card, four act cards (one line each), then the run. |
| `long_way_home_720p.mp4` | 1280x720, H.264 CRF 25, 9.8 MB. |
| `still_02` to `still_07` | Six PNG stills: Act I ride, Act III rift beam, Act III stasis release, Act IV BUZZ fetch, finale boom (all from the film at 1080p), and the Cascade Report. |
| `spec/` | `long_way_home_spec.mjs` (the machine as built), `sim.ts` (headless sim runner), `chk_ports.ts` (checks link counts against each port's `maxLinks`), `quick.sh`, and the two bug repros with their output. |

## How the film was made
- **Camera: Ride on the BOING (the main follow camera), Director for the finale.** The game's Record clip (MP4, 1080p, 30 fps) rendered both from one live run. Ride follows the *selected* part's base body, so the BOING is selected (V tool, click on the ball) before the run; without a selection Ride picks the fastest dynamic body.
- Cuts: Ride 0-86 s (Acts I, II, III, with the 60-86 s stasis wait sped up 4x and labelled "TIMER BRIDGE"), Ride 86-118 s (release, goo, BUZZ fetch and delivery), Director 118-134 s (singularity, kegs, bangsticks). The cards, lower-third labels and run-time counter were added with ffmpeg. The sped-up section is the only retiming; everything else is real time.
- **Sound:** the soundtrack is the game's own, rendered offline by Record clip (AAC 48 kHz stereo; mean level -21 dB, peak -1 dB, checked with ffmpeg volumedetect). The cards are silent. The producer heard the live game on the speakers: Chrome was relaunched with `--mute-audio` at about 22:33 (the world and settings persist in its profile) and every run and render after that was silent on the speakers. No live screencast was recorded, so there is no screen-recorded audio to worry about.
- Real input only (CDP Input events) to build, select, run and record. `Runtime.evaluate` was used only to read state (a read-only helper, `__p5`, projects world points to screen positions so the clicks land). The Photo-mode camera path tried first was keyed with real drags and F10 / K, but it was replaced by Ride, so it is not in the film.

## Stations (Warehouse, Studio set; z runs along the course)
| Act | Station | Parts | Measured (browser, film run) |
|---|---|---|---|
| I The Escape | Shelf, slope, funnel, tube | THE BUTTON, RINGER (1 s), BISCUIT, FLAP (shelf trapdoor), tagged BOING, SLOPE, 2 PLANKs, TUBE `route1` | press 1.0 s; ring 1.0 s; ball drops and rolls into the tube by about 4 s |
| I | First fans | MAINS A, DELAY 2.5 s, 2 GALEs (overhead, y 0.5, pitched 15 degrees down) | carries the ball to z about 10 by 12 s |
| I | Side gags | PIG IRON on a FLAP above 4 BRIKs; COILGUN ring, LEDGE, SLOPE, PIG IRON and 6 TOPPLE TILES | ambience; the COILGUN does not touch the BOING (steel only) |
| II The Locked Door | Door | LANCE + TRIPWIRE, FORCE WALL (door), TUBE `route2a`, GALEs g3/g4 | door opens 14.2 s when the ball breaks the beam |
| II | Slam (the setback) | LANCE + TRIPWIRE, FABRICATOR to RECYCLER one-shot latch, FORCE WALL, DELAYs | slam closes 18.2 s on the ball, which bounces back (z 14.5 to 9.2) |
| II | Pip and the yard | RINGER (30 s), HAMSTER DRIVE, PIP, DYNAMO, GALE g5; HENNY, DUSTY with a patrol zone, GRIT HOPPER, SPRONG | PIP wakes 7.2 s; the wheel pushes the ball on again at about 30 s |
| III The Rift | Rift | 2 RIFT GATEs (paired through the chip), TUBE `route3a` | teleport at 42.6 s |
| III | Lift | LANCE + TRIPWIRE, latch, FORCE WALL stop, TRACTOR BEAM (hold mode, pitch 45), DELAYs, TUBE `route4` | tractor on 49.5 s, lifts 49.6 s, off 53.0 s; ball drops into the tube and is blown by GALEs g7 to g10 to the cell by about 60 s |
| III | Stasis | FORCE WALL cell, STASIS FIELD, MAINS, DELAYs; 3 chained DELAYs (30+30+25 s) | cell opens 86.0 s, field engages 86.1 s, freezes the ball 87.2 s, releases 8 s later |
| IV Home | Goo and bowl | GOO VAT (opened 4 s after the cell), FORCE WALL end stop, BUZZ BEACON ("the bowl"), BUZZ, GRABBER (zones set with the zone tool) | goo opens 90.0 s; bowl called 98.0 s; grabber 104.0 s; BUZZ fetches 107.4 s, delivers 116.0 s |
| IV | Clock and celebration | HOURGLASS (120 s), DELAY 0.1 s, SINGULARITY, MAINS H, HOVER PAD holding a PIG IRON over a T-PLUNGER, 2 POWDER KEGs, 3 BANGSTICKs, GRAV WELL | singularity 120.1 s, plunger and kegs 120.4 s, singularity collapses 126.1 s |

Totals: **105 parts, 41 part types, 68 links, 6 TUBEs**. Cascade Report for the film run: score **12,192, Absolute Catastrophe**, K.O. 75, longest chain 9 links, parts used 85 of 105, peak 37 events at once, biggest boom POWDER KEG. Frame time while running in the browser: median 16.7 ms, worst 17 ms (vsync-capped), sim at 1x throughout.

The UI build took 8.8 minutes for the first pass (102 parts placed, 48 wires, 9 failed wires), then a second pass for tubes, the mixing DELAYs and missing links, plus the RIFT re-pairing. The record of these builds was not captured on video for this task.

## Hand-offs: physical vs timer bridge
**Physical (the ball or the world causes the next step): 9**
1. THE BUTTON opens the shelf FLAP by cable; the ball drops, rolls down the SLOPE and the funnel into the first TUBE.
2. The overhead GALEs (g1, g2) carry the ball along the tube (the power is a bridge, see below; the push is physical).
3. The ball breaks the first beam: the TRIPWIRE opens the door.
4. The ball breaks the second beam: the latch closes the slam wall on it (the setback).
5. PIP's wheel runs the DYNAMO and GALE g5, which pushes the ball on to the rift (the wake-up is a bridge).
6. GALE push into RIFT gate A: teleport to gate B.
7. The ball crosses the lift gap, breaks the beam, and the TRACTOR BEAM lifts it and drops it into the next tube.
8. GALEs g7 to g10 blow it along the tube to the cell wall.
9. BUZZ fetches the tagged BOING from the goo and delivers it to the beacon pad (about 8.6 s).

**Timer bridges: 10** (17 DELAYs, 2 RINGERs and 1 HOURGLASS in the document)
1. DELAY 2.5 s from the press powers GALEs g1/g2.
2. DELAY 21 s from the press powers GALEs g3/g4.
3. DELAY 4 s reopens the slam wall (part of the setback design).
4. RINGER 30 s wakes PIP (the wheel and GALE g5).
5. Three DELAYs in a row (30+30+25 s) open the cell wall and engage the STASIS FIELD at 86 s. The ball waits at the cell from about 52 s to 86 s, so this is the largest bridge (about 34 s of the film, shown at 4x).
6. DELAY 8 s releases the stasis field.
7. DELAY 4 s opens the GOO VAT.
8. DELAY 12 s calls BUZZ at 98 s.
9. DELAY 18 s fires the GRABBER.
10. **The finale is the clock, not the delivery.** The HOURGLASS (120 s) arms the SINGULARITY and cuts the HOVER PAD, which drops the PIG IRON onto the PLUNGER. BUZZ delivers at 116.0 s and the boom comes at 120.4 s because the clock runs out. They are close but not linked.
Plus short DELAYs of 0.1 to 4 s used as cable mixers or button-to-action delays (a FORCE WALL toggle and a MAINS `in` take one cable each, so two sources have to pass through a mix DELAY).

## What didn't work, or is not what it looks like (most serious first)
1. **GOO VAT slows the ball but does not hold it.** The FORCE WALL end stop inside the puddle is what stops it, so "stuck in the goo" is staged. The GRABBER did not demonstrably lift the BOING (it fires at 104 s; nothing in the footage shows the ball leaving the goo because of it). BUZZ does the real work.
2. **HOVER PAD, COILGUN and GRAV WELL do not act on a BOING**; they are on the machine with other props (PIG IRON on the pad and the COILGUN chase) for the finale and Act I.
3. **BISCUIT stays near the start**; the dog wakes (Act I) but is not part of the ball's journey.
4. **Run-to-run variation in Act II.** Of 5 full browser runs, 3 matched the headless sim (door 14.1 to 14.2 s, rift 42.2 to 42.6 s). Two did not: door 8.6 s / rift 33.2 s, and door 11.3 s / rift 38.8 s (that second one had my stray THUD sitting above the ball, see item 8, so it may not count). Everything from the stasis cell on is timer-driven and identical every time. The ball always arrived at the cell before the 86 s timer, from 52 s at the earliest to 65 s. The film uses a matching run.
5. **Record clip from the Cascade Report after Stop renders an idle machine.** It starts a fresh solo run with no Hand-of-God input, so THE BUTTON is never pressed: clips showed the ball still on the shelf at 20 s and the Ride camera sat on a static black ball. I lost two renders to this and first read it as "Ride is static". Open the clip dialog (Shift+F10) while the real run is still going and the clip replays it. A note in the HOW TO PLAY clip text would help.
6. **Record clip with Start above 0 hangs** while a run is live (Director 112 to 132, Path 110 to 134, both twice): the dialog sticks at "warming up effects, frame 0 / 30" with the clock frozen. Cancel (Esc) did not respond; only a page reload recovered. Start at 0 works every time (render about 1.1x to 1.5x of real time at 1080p 30 fps).
7. Ride follows the *selected* part, which is the right behaviour but not documented in the camera table. Select the ball before pressing Let it rip.
8. UI: crowded or far ports needed retries (9 failed wires in the first pass); dragging near the debug readout area was swallowed by HUD overlays; the Run bar covers the bottom of the screen, so a THE BUTTON placed there cannot be clicked in the run (my camera, not a bug). A stray THUD was placed once by clicking with a part armed (my mistake, removed).

## The two suspected game bugs
### 1. "GALE doesn't push a BOING": **not a defect**; placement and cone
Repro: `spec/repro_gale.mjs` (`PRESET=warehouse SPEC=repro_gale.mjs node sim.ts 6 "." "^[AB]_"`). MAINS (on) to GALE (air 100%), balls 0.3, 0.6 and 1.2 m in front of the nozzle. Distance moved in 6 s (`spec/repro_gale_output.txt`):

| Gale | Ball | 0.3 m | 0.6 m | 1.2 m |
|---|---|---|---|---|
| A: on the floor, flat | BOING (0.6 kg) | 6.43 m | 5.89 m | 4.85 m |
| A | STITCH | 0 | 3.01 m | 2.50 m |
| A | FUZZ | 0 | 4.91 m | 4.04 m |
| B: overhead (y 0.5), pitched 15 degrees down | BOING | 0 | 0 | 4.68 m |
| B | STITCH | 0 | 0 | 2.37 m |
| B | FUZZ | 0 | 0 | 3.85 m |

- The BOING is pushed fine at every distance when the GALE is on the floor, so the old "no push" was a placement problem. Overhead, the ball sits below the cone's lower edge until about 0.7 to 1.2 m from the nozzle (15 degree half-angle cone, nozzle 12.2 cm above its base), then moves normally.
- Small real quirk: a STITCH or FUZZ 0.3 m from a floor GALE does not move at all, while the BOING does. It looks like a close-range dead zone that depends on the object's size. Minor.
- In the real machine the overhead GALE chain carries the BOING along a floor TUBE at about 1 m/s; GALEs every 3 to 5 m keep it moving.

### 2. "TUBE rim bounce": **not a defect**; the centreline height makes a lip
Repro: `spec/repro_tube.mjs` (`PRESET=warehouse SPEC=repro_tube.mjs POS="^ball" node sim.ts 8 "." "^ball"`). A BOING pushed into a 6 m TUBE by a floor GALE; only the tube's centreline height changes. The bore is 0.288 m, so a floor-flush tube has its centreline at y = 0.15, and the lip is (y - 0.144) m. Ball position (z) at t = 3, 5, 7 s (`spec/repro_tube_output.txt`):

| Tube y | Lip | z at 3 s | z at 5 s | z at 7 s |
|---|---|---|---|---|
| 0.15 | 0.6 cm | 0.58 | 2.61 | 4.50 (rolls through) |
| 0.17 | 2.6 cm | 0.29 | 1.72 | 3.32 (rolls through, slower) |
| 0.20 | 5.6 cm | -0.26 | -0.13 | -0.12 (stops at the mouth) |
| 0.25 | 10.6 cm | -0.14 | -0.14 | -0.14 (stops at the mouth) |

- A ball rolling on the floor cannot climb a lip of about 5 cm or more: it stops at the mouth, or bounces off the rim if it arrives with speed. The Path tool puts the tube centreline at the clicked height + 0.15, so clicking on the floor gives a flush tube; clicking on a raised work plane gives a lip.
- The ball enters a tube best rolling on the floor; an airborne arrival bounces off the rim (seen in the first design, and not part of the minimal repro).
- A small suggestion for the game, not a defect: a flare or ramp on the tube mouth, or a note on the Path tool, would save the next builder the same hour.

## Notes for the producer
- The film is a real run, replayed offline by Record clip. Nothing was edited except the cards, labels and the 4x stasis wait.
- Not shown on screen: the zone tools (DUSTY, GRABBER), the Matter switch and Save were exercised during the build (results in `lw_build.json`, scratch folder, not kept); undo and redo showed no change in the part count in the first pass (the check ran with a tool that did not place the part), so I would not treat that as tested.
- Everything is in the Warehouse preset on the Studio set.
