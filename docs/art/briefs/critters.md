# Critter briefs

The original cast of eight from GAME_SPEC §11: six soft-sculpt animals and two robots. None of them is ever shown hurt.

Back to the index: [README.md](./README.md)

| Asset | type_id | Class | Ship | Stage |
|---|---|---|---|---|
| MOCHI | `mochi` | XL | M2 | brief |
| PIP | `pip` | XL | M2 | brief |
| GOBY | `goby` | XL | M2 | brief |
| BANDIT | `bandit` | XL | M2 | brief |
| BISCUIT | `biscuit` | XL | M4 | brief |
| HENNY | `henny` | XL | M4 | brief |
| DUSTY | `dusty` | XL | M4 | brief |
| BUZZ | `buzz` | XL | M5 | brief |
| BUZZ BEACON (companion, GAME_SPEC §12.10) | `buzz_beacon` | S | M5 | brief (in Buzz's Notes) |

**Family block.**
- AI numbers on this page follow SIMULATION §5.10, §5.11 and §7. All vision cones are 110°.
- Every critter's collision capsule and ragdoll capsules use `phys = fur` (SIMULATION §4.3), with per-shape `friction` / `restitution` overrides where a brief gives them. The robots use hard-surface materials.
- Every critter must fit the Trap Box interior (frame.md: 7 × 5 × 5 cells, interior 0.66 × 0.46 × 0.46 m at floor level) in its `trapped` pose. The sim turns the critter to the cage's long X axis. All eight fit, including Dusty's Ø 0.366 bumper.

---

### MOCHI: Dumpling-round house cat
`mochi` · Critters · Class XL · Ship M2 · Inspired by (internal only): the 1993 cat's role only (no shared name, design or likeness)

**Concept.** A plump cream cat shaped like the rice cake she's named after: soft dumpling body, short legs, ginger points on the ears, paws and tail, and a cobalt collar. Mochi naps like a professional, hunts like an opportunist and takes offence at everything. At 10 m she reads as a round cream blob with an upright tail and a blue ring at the neck.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.16 × 0.33 × 0.45 m (to the crown, ear tips reach z 0.365; nose to rump; the tail adds 0.30 m, carried up and back) · origin: centre of mass at (0, −0.02, 0.14); `root` bone on the floor beneath it. All positions here are root-space (floor = z 0, nose toward −Y) |
| Mass · physics | 4.0 kg · `phys = fur` (overrides: friction 0.8, restitution 0.1) · ragdoll on impacts > 3 N·s · nudges loose parts ≤ 0.5 kg while walking |
| Collision | animated: `COL__capsule__0` along Y, r 0.075, length 0.42, centre (0, −0.02, 0.14) · ragdoll: the `RAG__` set (see Rig) |
| Materials (60/30/10) | neutral: `kn_fur_mochi` cream coat · signature: ginger points (same master, texture mask) · accent: `kn_fabric_cobalt` collar + `kn_powder_bone` tag · eyes, nose leather, pads, teeth and claws on `kn_ceramic_graphite` with the 1024² eye set (catchlights modelled as geometry and painted bone) |
| Ports | none |
| Pivots | none (skinned) |
| Sensors | none authored. AI values live in `mochi.part.json`: vision cone 8 m / 110° from `EMIT__look__eyes`. Lure radii: Pip 8 m, a flopping Goby 10 m, snack Lures 3 m. Startles on Sound ≥ 65 dB effective loudness (SIMULATION §5.10) |
| Emitters | `EMIT__look__eyes` (0, −0.215, 0.255) +X → −Y, head-parented · `EMIT__voice__mouth` (0, −0.245, 0.215) · `EMIT__emote__bubble` (0, −0.15, 0.42) · `EMIT__step__paw_fl/fr/hl/hr` at the paw contacts · `EMIT__shove__chest` (0, −0.22, 0.12): forward nudge point for light parts |
| LEDs / screens | none (no emissives on animals) |
| States | nap → alert → stalk / chase (Pip, a flopping Goby or a snack) → pounce → celebrate · startled (loud Sound: arched-back jump) → flee (Biscuit) · trapped (Trap Box) · tumble → dizzy → getup → indignant emote → resume |
| Animation | baked clips (below) + face shape keys + procedural spring on `tail_05–08`, the ears and `collar_tag` |
| Fracture | none, ever |
| Skins / variants | cream-point (default) · smoke (solid soft grey-blue `#9BA0AA`, cream belly, no stripes) · midnight (`#2E2C33`, cream chin bib). All keep the cobalt collar |
| Budget | LOD0 ≈ 38,000 tris · 4096² body (BaseColor, ORM, Normal) + 1024² eye set · 4 slots: fur, eye set, collar, tag |
| Audio hooks | voice barks `vo_mochi_<state>`, 8–12 each: idle (trill/chirrup), curious (rising "mrrp?"), chase (prey chatter "ek-ek-ek"), pounce (effort "hup"), startled (squeaky yowl), flee (scramble mew), indignant (grumbly "mrrrow"), dizzy (woozy mew), happy (purr loop), sleep (tiny snore), trapped (plaintive mew) · foley: soft paw steps per surface, landing thump, critter bodyfall, tag clink, groom licks, claw scrabble on slick floors |
| Personality | Dignified, lazy, opportunistic. The self-appointed boss of the room. Easily offended, quickly forgiving; default resting face is a faint smug. |
| Proportions | head 0.13 m chin-to-crown of 0.33 m total (39 %); head 0.14 wide with round cheeks · eyes Ø 0.032 at (±0.030, −0.215, 0.255) (23 % of head width) · body barrel 0.16 wide × 0.17 deep, length 0.30 · legs 0.12 (0.8× real) · ears 0.05 rounded triangles · tail 0.30, Ø 0.034 → 0.026 · nose tip (0, −0.255, 0.232) |
| Signature accessory | Cobalt knit collar (`kn_fabric_cobalt`, 12 mm wide, 1.4× real) with a round bone tag Ø 0.022 (fish-glyph decal) hanging at (0, −0.185, 0.180) on the `collar_tag` bone |
| Fur/skin material | `kn_fur_mochi`: cream `#EEE4D2` body · ginger points `#D99252` on ears, paws and the last 3 tail rings · white `#F8F4EC` muzzle, chin and belly · rose `#D98C8C` nose leather and pads (eye set). Big sculpted clumps on the cheek ruff, chest bib and tail tufts; shell fur on the 12 GB and 16 GB tiers only (High/Ultra) |
| Face shape keys | ART_BIBLE §8 set: basis = neutral, `sk_blink_l/r`, `sk_happy`, `sk_smug`, `sk_scared`, `sk_angry`, `sk_dizzy`, `sk_sleepy`, `sk_surprised`, `sk_determined`, `sk_vis_a/o/e`, `sk_brow_up_l/r`, `sk_brow_down_l/r` · extras: `sk_whiskers_fwd`, `sk_blep` (tongue tip), `sk_fur_puff` (whole-body bristle for `arch_scared`) · ears are bones |
| Rig | 44 deform bones: `root`, `hips`, `spine_01–03`, `neck_01–02`, `head`, `jaw`, `eye_l/r`, `ear_l/r_01–02`, front legs `scapula/upperarm/forearm/paw/toe_l/r` (10), hind legs `thigh/shin/hock/paw/toe_l/r` (10), `tail_01–08`, `collar_tag` · ≤ 4 weights per vertex · IK and pole controls are non-deform · ragdoll: 15 capsules: `RAG__hips` (0.93 kg, swing 20°, twist 10°), `RAG__spine_02` / `_03` (0.70 each, 25° / 15°), `RAG__neck_01` (0.15, 35° / 25°), `RAG__head` (0.50, 40° / 30°), front upper ×2 (0.12, 70° / 20°), front lower ×2 (0.06, 70° / 10°), thighs ×2 (0.20, 70° / 20°), shins ×2 (0.08, 70° / 10°), `RAG__tail_01` (0.06, 60° / 30°), `RAG__tail_04` (0.04, 60° / 30°) = 4.0 kg |
| Clips | `mochi__` + required: `idle`, `idle_alt`, `walk`, `run`, `chase`, `flee`, `startled`, `tumble`, `getup`, `dizzy`, `trapped` (sitting tucked inside the Trap Box: ears flat, tail wrapped round the paws with only the tip flicking; ≤ 0.36 m tall), `celebrate`, `sleep` (curled donut nap), `sniff`, `emote_happy`, `emote_angry`, `emote_confused` · role: `pounce` (1.1 s: 0.4 s butt-wiggle wind-up, then a 0.9 m leap; the engine moves the body on a ballistic arc), `arch_scared` (0.8 s sideways hop 0.5 m up (SIMULATION §7.3; the engine applies the jump impulse), arched back, `sk_fur_puff` 1.0, bottle-brush tail), `groom` (3 s loop: paw lick and face wipe; in the `idle_alt` pool), `stalk` (low crouch-walk loop), `shove` (additive 0.5 s paw swipe over `walk`) · 30 fps, no root motion, seamless loops |
| Emotes | `eyes_pip` (eyes + Pip silhouette) · `snack_heart` · `grumpy` (flat-mouth cat face) · `zzz` · `!` · `stars` · `steam` (indignant) · `?` (lost target) · `dog_alert` (Biscuit-ear silhouette) |
| Sizes (real scale) | 0.45 m nose to rump + 0.30 m tail, 0.21 m at the shoulder, 4 kg: an ordinary adult house cat |

**Read at a glance.** A round cream body, ginger ear tips, a tall ginger-tipped tail and a cobalt collar.
**Notes / don'ts.** Never hurt: big hits go tumble → `dizzy` → `emote_angry` → `getup`. Soot is an engine overlay (the fur shader's `soot` parameter), cleared on Stop. Claws never extend toward another critter; the arch and hiss are comedic. Original design only: not the 1993 cat (Pokey), no orange cartoon tabby with heavy lids, no chubby grey striped cat, no tuxedo pattern, no bow on the ear, no mouthless face.

---

### PIP: Striped dwarf hamster athlete
`pip` · Critters · Class XL · Ship M2 · Inspired by (internal only): the 1993 mouse's role only (no shared name, design or likeness)

**Concept.** A round biscuit-coloured hamster with a dark stripe down the back, cheeks that balloon with seeds, and a Beam sweatband: it trains for the Hamster Drive like an Olympian. Pip is the smallest land critter (only Goby is smaller), so the silhouette leans on a big head, big ears and the bright band.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.075 × 0.085 × 0.13 m (to ear tips; nose to rump) · origin: centre of mass at (0, 0.00, 0.035); `root` on the floor beneath it. Positions are root-space |
| Mass · physics | 0.12 kg · `phys = fur` (overrides: friction 0.9, restitution 0.15) · ragdoll on impacts > 0.3 N·s |
| Collision | animated: `COL__capsule__0` along Y, r 0.032, length 0.11, centre (0, 0, 0.034) · ragdoll: `RAG__` set |
| Materials (60/30/10) | neutral: `kn_fur_pip` biscuit coat · signature: espresso dorsal stripe + cream belly (texture mask) · accent: `kn_fabric_beam` sweatband · eye set on `kn_ceramic_graphite` (1024²) |
| Ports | none |
| Pivots | none (skinned) |
| Sensors | none authored. AI (`pip.part.json`): vision 4 m / 110°; seed and burrow Lure radius 4 m; flees Mochi inside 2.5 m. Pip can be placed straight into an empty Hamster Drive, where its `root` binds to the wheel's `socket_pip` (drive.md) |
| Emitters | `EMIT__look__eyes` (0, −0.050, 0.055) · `EMIT__voice__mouth` (0, −0.064, 0.040) · `EMIT__emote__bubble` (0, −0.02, 0.15) · `EMIT__step__paw_fl/fr/hl/hr` · `EMIT__crumbs__cheek` (0, −0.045, 0.035): seed-crumb puffs while eating |
| LEDs / screens | none |
| States | wander → seek Lure (seeds, burrow) → `stuff_cheeks` → hide in burrow · flee (Mochi) · in a Hamster Drive: `sleep`, curled at the wheel bottom (the wheel never spins while Pip sleeps) → bumped: `startled` → 6 s `wheel_sprint` (the drive's Spin output) → wheel coasts 1 s while Pip sits and pants (`idle` in place) → `sleep`. `wheel_exit` plays only when a hit knocks Pip out of the wheel · tumble → dizzy → getup |
| Animation | baked clips + face shape keys + procedural whisker jitter and cheek jiggle |
| Fracture | none, ever |
| Skins / variants | biscuit-stripe (default) · pearl (`#ECE6DC`, faint grey stripe) · cinnamon (`#C9864B`, cream belly, no stripe). All keep the sweatband |
| Budget | LOD0 ≈ 26,000 tris · 4096² + 1024² (the director cam holds close on Pip in the wheel) · 3 slots |
| Audio hooks | voice barks `vo_pip_<state>`, 8–12 each: idle chitter, curious sniff-squeak, happy trill, alarm squeak (Mochi), munching, wheel huff-huff (tempo-matched to cadence), celebrate "wheee", dizzy wobble squeak, indignant chirp, sleep tiny breaths · foley: patter steps, cheek-pouch "pop" when emptying, burrow dig, tumble bodyfall (light) |
| Personality | Earnest little athlete. Always hungry. Anxious but brave when seeds are at stake. Treats every wheel run like a marathon final. |
| Proportions | head 0.036 m tall of 0.085 m (42 %); head : body by length 1 : 1.4 (0.054 of 0.13) · eyes Ø 0.012 at (±0.016, −0.050, 0.055) · ears Ø 0.018, round (1.3× real) · body a 0.075 W × 0.09 L × 0.06 H bean (z 0.008–0.068, under the head's rear) · legs 0.008 visible · stub tail 0.008 |
| Signature accessory | Beam sweatband (`kn_fabric_beam`), a 6 mm ring around the head between brow and ears, centre (0, −0.040, 0.062), with a short knot tail on the `band_knot` cloth bone |
| Fur/skin material | `kn_fur_pip`: biscuit `#DDB98F` coat · espresso `#5B4337` dorsal stripe, 8 mm wide, crown to rump · cream `#F5ECDD` belly, cheeks and muzzle · pink `#E7A9A0` ear insides, paws and nose |
| Face shape keys | ART_BIBLE §8 set (as Mochi) · extras: `sk_cheeks_full` (pouches 1.6×), `sk_nose_twitch`, `sk_whiskers_fwd` |
| Rig | 29 deform bones: `root`, `hips`, `spine_01–03`, `neck`, `head`, `jaw`, `eye_l/r`, `ear_l/r`, `cheek_l/r`, front `upperarm/forearm/paw_l/r` (6), hind `thigh/shin/foot_l/r` (6), `tail_01–02`, `band_knot` (sweatband tail) · ragdoll: 7 capsules: `RAG__hips`, `RAG__spine_02`, `RAG__head`, one per limb (all ≥ 5 mm thick); masses sum to 0.12 kg; head 40° / 30°, limbs 70° / 20° |
| Clips | `pip__` + required: `idle`, `idle_alt`, `walk`, `run`, `chase`, `flee`, `startled`, `tumble`, `getup`, `dizzy`, `trapped`, `celebrate`, `sleep` (curled ball), `sniff`, `emote_happy`, `emote_angry`, `emote_confused` · role: `wheel_run` (seamless 0.33 s cycle at 1× = 0.3 m/s surface speed, 0.10 m per cycle; the Hamster Drive plays 0.6–2.0×; authored in place on a 0.24 m inner-Ø running surface with the body centred 0.04 m above it), `wheel_sprint` (6 s burst: `wheel_run` at 2.0× = 0.6 m/s, matching drive.md, with ears back and `sk_determined`), `wheel_exit` (stumble off into `dizzy`), `stuff_cheeks` (1.2 s, `sk_cheeks_full` 0 → 1), `burrow_enter`, `burrow_exit` |
| Emotes | `seed` · `cat_alert` (Mochi ears + "!") · `sweat` · `zzz` · `stars` · `heart` · `stopwatch` (wheel) · `?` |
| Sizes (real scale) | 0.13 m long, 0.12 kg: between a large dwarf and a small Syrian hamster |

**Read at a glance.** A round tan bean with a dark back stripe, big round ears and a bright cyan headband.
**Notes / don'ts.** Pip is a hamster, not a mouse: no long tail, nothing like the 1993 mouse (Mort). Avoid the famous orange-on-white cartoon hamster: no orange patch pattern, no ear tufts. The sweatband must not read as headphones. At 2× wheel speed the legs blur through motion blur, never frame skips. Never squashed: Pip ragdolls easily and pops right back up.

---

### GOBY: Fantail goldfish with a flair for drama
`goby` · Critters · Class XL · Ship M2 · Inspired by (internal only): the 1993 fish's role only (no shared name, design or likeness)

**Concept.** A chubby tangerine fantail with huge eyes and a Plasma bow clipped to its dorsal fin. Goby lives in the Fishbowl, presses its face to the glass to watch the machine and, when the bowl shatters, flops about dramatically until a bubble whisks it to safety. The fins are oversized so it reads through glass and water.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.03 × 0.055 × 0.095 m (dorsal-fin top; nose to tail tip) · origin: centre of mass at (0, −0.005, 0.020); `root` sits on the belly line beneath it (z 0), which is also the floor contact when flopping. Positions are root-space |
| Mass · physics | 0.03 kg · neutrally buoyant in Matter water · in air `phys = fur` (override: restitution 0.3 for comic flop bounces) · ragdoll-lite on impacts > 0.1 N·s |
| Collision | animated: `COL__capsule__0` along Y, r 0.016, length 0.07, centre (0, −0.005, 0.020) · ragdoll: `RAG__` set |
| Materials (60/30/10) | neutral: `kn_fur_goby` tangerine body (natural critter colour) · signature: gold belly and peach-to-cream fins (texture) · accent: `kn_fabric_plasma` fin bow · eye set on `kn_ceramic_graphite` |
| Ports | none |
| Pivots | none (skinned) |
| Sensors | none authored. AI (`goby.part.json`): home = the Fishbowl it was placed in. Swims inside the bowl's `SENSOR__catch__swim` volume (contraptions.md) with its centre of mass kept ≥ 0.05 m inside the boundary, so the whole body (fins included) stays clear of the glass, the surface and the arch. Follows food-flake Lures inside the bowl. On bowl break → `flop` (a Lure for Mochi, radius 10 m, SIMULATION §5.11) → after 8 s → `bubble_rescue`: the bubble carries Goby to the nearest Matter water within 3 m that is deep enough to swim in. With none, it pops and Goby waits as an icon in the empty cradle until Stop |
| Emitters | `EMIT__look__eyes` (0, −0.040, 0.030) · `EMIT__voice__mouth` (0, −0.048, 0.022) · `EMIT__emote__bubble` (0, 0, 0.11) · `EMIT__bubbles__mouth` (same point as voice): idle bubble trickle underwater · `EMIT__bubble__body` (0, −0.005, 0.020): rescue bubble, a Ø 0.12 iridescent bubble (vfx.md `fx/goby_bubble`) · `EMIT__splash__body`: flop splashes |
| LEDs / screens | none |
| States | swim idle → cruise → follow food → dart (startled) · bowl breaks: tumble (airborne in the water burst) → flop → bubble rescue → home · sleep · celebrate |
| Animation | baked clips + face shape keys + procedural fin flutter (sine layer on the fin chains, ∝ swim speed) |
| Fracture | none, ever |
| Skins / variants | tangerine (default) · calico (white `#F4EFE8` with orange and charcoal patches) · ghost (pale peach `#F8D9C0`) · black moor (`#2F2E36` with a gold belly). All keep the bow |
| Budget | LOD0 ≈ 25,000 tris (dense fins for deformation) · 4096² + 1024² · 3 slots |
| Audio hooks | voice barks `vo_goby_<state>` (blub-voiced), 8–12 each: idle bloop, curious bubble-trill, happy gurgle, startled gulp, flop gasp (comic, never distressed), dizzy burble, sleep slow bubbles, celebrate "bloo-wee", rescue relieved sigh-bubble · foley: fin flick, water swish, wet flop slap, splash, rescue-bubble pop |
| Personality | Dreamy and curious with a touch of drama. A born spectator who watches every machine through the glass, then does a smug little loop after being rescued. |
| Proportions | head 0.026 m of the 0.065 m body (40 %) · body depth 0.035, thickness 0.030 · eyes Ø 0.011, slightly bulging, at (±0.011, −0.040, 0.030) · double fantail 0.030 long × 0.042 span · dorsal fin to z 0.055 · pectorals 0.012 |
| Signature accessory | Plasma fin bow (`kn_fabric_plasma`), 0.012 wide, clipped to the leading edge of the dorsal fin at (0, −0.005, 0.050), riding on `dorsal_02` |
| Fur/skin material | `kn_fur_goby` used as skin (scale-clump sculpted normal, sheen 0.5, shell fur off): tangerine `#F47C2C` back · gold `#F6C25A` belly · fins peach `#FFB07A` fading to cream `#FBE3C5` at the edges, painted and opaque (no transmission, so bowl + water + fins never exceed 2 transparent layers) |
| Face shape keys | ART_BIBLE §8 set, adapted: stylised upper lids only; brows are raised scale ridges · extras: `sk_pucker` (glass kiss), `sk_gulp`, `sk_cheeks_puff` |
| Rig | 28 deform bones: `root`, `spine_01–06`, `head`, `jaw`, `eye_l/r`, `gill_l/r`, `pectoral_l/r_01–02` (4), `pelvic_l/r`, `dorsal_01–02`, `anal_01`, `tail_l/c/r_01–02` (6) · ragdoll: 4 capsules: `RAG__head`, `RAG__spine_02`, `RAG__spine_04`, `RAG__tail_c_01` (swing 30°, twist 10°; 0.03 kg total) |
| Clips | `goby__` + required, mapped to a swimmer: `idle` (fin-sculling hover), `idle_alt` (glass kiss), `walk` (cruise), `run` (burst), `chase` (follow a flake), `flee` (dart to the back of the bowl), `startled` (jolt and spin), `tumble` (airborne flail, blended with the ragdoll), `getup` (on the floor: flips belly-down), `dizzy` (spiral swim; on the floor, dizzy eyes), `trapped` (held by a Tractor Beam or Stasis: fins still, eyes darting), `celebrate` (loop-de-loop), `sleep` (low hover, half lids, slow fins), `sniff` (nose-poke at gravel or a flake), `emote_happy`, `emote_angry`, `emote_confused` · role: `swim` (locomotion blendspace: 0.6 s slow / 0.3 s fast cycle), `flop` (0.5 s loop, 0.03 m bounces, tail slaps), `bubble_rescue` (1.2 s: curls up as the bubble forms, winks, pops away) |
| Emotes | `bubbles` · `heart` · `!` · `water_drop` ("need water") · `stars` · `food_flake` · `kiss` · `zzz` |
| Sizes (real scale) | 0.095 m including the tail, 30 g: a big pet-shop fantail |

**Read at a glance.** A bright orange teardrop with a giant cream fan tail, big eyes and a pink bow.
**Notes / don'ts.** Never shown suffocating: `flop` lasts 8 s (long enough to lure Mochi, SIMULATION §7.3), so it must stay comic the whole time: an anxious-comic face, big eyes, gasping "blub" barks and bouncy tail slaps, never limp, still or distressed. Then the rescue. Mochi can bat at Goby but never catches it; a pounce on Goby triggers the rescue bubble early (gag). Not a clownfish or a blue tang, no eyelashes or lipstick, nothing like the 1993 fish. Fins stay big: they are the read through two layers of glass and water.

---

### BANDIT: Masked raccoon with sticky hands
`bandit` · Critters · Class XL · Ship M2 · Inspired by (internal only): the 1993 monkey's role only (no shared name, design or likeness)

**Concept.** A grey raccoon with a charcoal mask, a ringed tail, dexterous oversized hands and an Amber satchel for his "finds". Shine something at him and he'll pedal the Pedal Rig like a pro; leave a shiny part lying around and it's gone. He's the chaos agent, cheeky and proud, never mean.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.18 × 0.30 × 0.48 m (on all fours, to ear tips; nose to rump; ringed tail adds 0.26 m) · 0.40 m tall when bipedal · origin: centre of mass at (0, −0.02, 0.15); `root` on the floor beneath it. Positions are root-space, quadruped pose |
| Mass · physics | 5.5 kg · `phys = fur` (overrides: friction 0.85, restitution 0.1) · ragdoll on impacts > 4 N·s |
| Collision | animated: `COL__capsule__0` along Y, r 0.08, length 0.42, centre (0, −0.02, 0.15); the engine stands it upright (r 0.07, length 0.36) during bipedal clips · ragdoll: `RAG__` set |
| Materials (60/30/10) | neutral: `kn_fur_bandit` ash-grey coat · signature: charcoal mask and tail rings (texture mask) · accent: `kn_fabric_amber` satchel with a `kn_brass` press-stud · eye set on `kn_ceramic_graphite` |
| Ports | none |
| Pivots | none (skinned) |
| Sensors | none authored. AI (`bandit.part.json`): vision 6 m / 110° for shiny parts (steel, chrome, brass or glass bodies ≤ 0.5 kg); shiny Lure radius 5 m (SIMULATION §5.11). A shiny Lure or a Sound startle within a Pedal Rig's 1.5 m `SENSOR__lure__range` (drive.md) sends him to pedal (8 s per stimulus) |
| Emitters | `EMIT__look__eyes` (0, −0.205, 0.235) · `EMIT__voice__mouth` (0, −0.235, 0.205) · `EMIT__emote__bubble` (0, −0.12, 0.42) · `EMIT__step__paw_fl/fr/hl/hr` · stolen items attach to the non-deform socket bone `prop_r` (right palm) |
| LEDs / screens | none |
| States | wander → spot shiny → `steal_grab` → `steal_carry` to a hideout (the nearest occluded spot ≥ 2 m away) → drop → `loot_admire` · lured or startled near a Pedal Rig → `pedal_mount` → `pedal` (8 s per stimulus) → `pedal_dismount` · tumble → dizzy → getup |
| Animation | baked clips + face shape keys + procedural tail spring (`tail_04–08`) and satchel jiggle |
| Fracture | none, ever |
| Skins / variants | ash grey (default) · silver (`#B9B8BE`) · cinnamon (`#9C7A5E`, warm brown coat, charcoal mask kept). All keep the satchel |
| Budget | LOD0 ≈ 45,000 tris (articulated hands) · 4096² + 1024² · 4 slots: fur, eye set, satchel fabric, press-stud |
| Audio hooks | voice barks `vo_bandit_<state>`, 8–12 each: idle chitter-mutter, curious trill, sneaky snicker (on grab), greedy coo (admire), startled squawk-chirr, pedal effort huffs (tempo-matched), indignant chatter rant, dizzy warble, happy purr-chirr, sleep wheezy snore · foley: padded steps, hand pats, satchel rustle and flap slap, item jingle while carrying |
| Personality | Cheeky kleptomaniac with a heart of gold-plated tin. A motor-mouthed chitterer who only works hard for shinies, and very proud of the loot. |
| Proportions | head 0.12 m of 0.30 m (40 %), 0.15 wide with cheek ruffs · mask band 0.04 tall across the eyes, with a lighter rim around each eye so they pop · eyes Ø 0.026 at (±0.032, −0.205, 0.235) · hands 1.3× real with 4 visible fingers · shoulder 0.20 · tail 0.26 long, Ø 0.06 bushy, 5 charcoal rings |
| Signature accessory | Amber satchel (`kn_fabric_amber`): bag 0.09 × 0.07 × 0.03 riding on the left flank (+X), centre (0.07, 0.02, 0.12), strap over the right shoulder, flap with a brass press-stud; bones `satchel` and `satchel_flap` |
| Fur/skin material | `kn_fur_bandit`: ash grey `#8E8C93` · charcoal `#33333A` mask and tail rings · cream `#EEE7DB` brow, muzzle and ear rims · dark `#4A4A50` hands and feet |
| Face shape keys | ART_BIBLE §8 set (as Mochi) · extras: `sk_grin_sly` (one-sided smirk), `sk_whiskers_fwd`, `sk_eyes_sparkle` (squint-smile; `loot_admire` also scales the catchlights up through the `eye_l/r` bones) |
| Rig | 43 deform bones + `prop_r` socket: `root`, `hips`, `spine_01–03`, `neck_01–02`, `head`, `jaw`, `eye_l/r`, `ear_l/r`, arms `clavicle/upperarm/forearm/hand/thumb/fingers_l/r` (12), legs `thigh/shin/foot/toe_l/r` (8), `tail_01–08`, `satchel`, `satchel_flap` · ragdoll: 14 capsules: hips, spine_02, spine_03, head, upper and lower arms ×2, thighs and shins ×2, `tail_01`, `tail_04`; 5.5 kg total; spine 25° / 15°, head 40° / 30°, limbs 70° / 20°, tail 60° / 30° |
| Clips | `bandit__` + required: `idle`, `idle_alt`, `walk`, `run`, `chase`, `flee`, `startled`, `tumble`, `getup`, `dizzy`, `trapped` (sitting up, tail curled round the feet so he fits the Trap Box's 0.66 m length), `celebrate`, `sleep`, `sniff`, `emote_happy`, `emote_angry`, `emote_confused` · role: `pedal` (seated loop, 1 crank rev per 1.0 s at 1×; the rig plays 0.6–2.0×), `pedal_mount`, `pedal_dismount`, `steal_grab` (0.7 s reach and snatch; the item snaps to `prop_r` at frame 12), `steal_carry` (bipedal waddle loop hugging the item, glancing back every second cycle), `loot_admire` (holds the item up, sparkle eyes), `wash_hands` (`idle_alt` pool) |
| Emotes | `sparkle` (shiny) · `!` · `grin` · `sweat` · `stars` · `zzz` · `angry` · `pedal` (crank glyph) · `?` |
| Sizes (real scale) | 0.48 m nose to rump + 0.26 m tail, 0.20 m at the shoulder, 5.5 kg: a young adult raccoon |

**Read at a glance.** A grey body with a black eye mask, a fat ringed tail and an orange-yellow bag at the hip.
**Notes / don'ts.** Pedal Rig fit (agreed with drive.md): the Pedal Rig has its saddle 0.11 m above and 0.03 m behind the crank axis, a crank radius of 0.035 m, and grips 0.21 m above the saddle. So the pedals sweep 0.08–0.15 m from the saddle top. Bandit's hip-to-sole reach (leg straight, measured from the saddle contact) is 0.20 m, so the far pedal is at ≈ 75 % extension and the near pedal keeps the knee well bent, never folded flat. His seated shoulder height is 0.24 m with a 0.20 m arm reach, so the grips sit 0.03 m below his shoulders, an easy forward reach. He steals only small shiny parts ≤ 0.5 kg, never eggs or other critters. Original design only: no clothes beyond the satchel, no gadgets or weapons, no striped burglar shirt, no "$" loot sack, nothing like the 1993 monkey or any famous film raccoon.

---

### BISCUIT: Barrel-chested good boy with a big bark
`biscuit` · Critters · Class XL · Ship M4 · Inspired by (internal only): none

**Concept.** A stocky, short-legged toast-coloured mutt with folded ears, a plume tail curled over his back and an Ignition bandana. He sleeps like a log until something goes bang, then he's up and chasing Mochi with a bark every second and a half. At 12 kg he barges through anything in his way, all joy and no malice.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.22 × 0.40 × 0.62 m (to ear tops; nose to rump; the tail curls over the back) · origin: centre of mass at (0, −0.03, 0.20); `root` on the floor beneath it. Positions are root-space |
| Mass · physics | 12 kg (spec) · `phys = fur` (overrides: friction 0.8, restitution 0.08) · ragdoll on impacts > 10 N·s · barges through: shoves bodies ≤ 6 kg aside |
| Collision | animated: `COL__capsule__0` along Y, r 0.11, length 0.56, centre (0, −0.03, 0.20) · ragdoll: `RAG__` set |
| Materials (60/30/10) | neutral: `kn_fur_biscuit` toasted-tan coat · signature: cream chest, socks and muzzle + brown ear tips (texture mask) · accent: `kn_fabric_ignition` bandana · eye set on `kn_ceramic_graphite` |
| Ports | none |
| Pivots | none (skinned) |
| Sensors | none authored. AI (`biscuit.part.json`): wakes on Sound ≥ 55 dB effective loudness (SIMULATION §5.10); vision 10 m / 110° for Mochi; Mochi Lure radius 10 m; while chasing he barks every 1.5 s, and each bark is a Sound-channel pulse from `EMIT__bark__mouth` (other critters startle) |
| Emitters | `EMIT__look__eyes` (0, −0.27, 0.32) · `EMIT__bark__mouth` (0, −0.33, 0.29) +X → −Y: Sound pulse origin (pink ring VFX + audio) · `EMIT__emote__bubble` (0, −0.18, 0.52) · `EMIT__step__paw_fl/fr/hl/hr` |
| LEDs / screens | none |
| States | sleep → (Sound) `wake_startle` → look → chase Mochi (`bark` every 1.5 s) → lose her → `sniff` trail → settle → sleep · barge · tumble → dizzy → getup → `shake_off` |
| Animation | baked clips + face shape keys + additive `tail_wag` and procedural ear and bandana spring |
| Fracture | none, ever |
| Skins / variants | toasted tan (default) · black-and-tan (`#2F2B2B` back, `#B97942` points) · cream (`#EAD9BB` all over, tan ears). All keep the bandana |
| Budget | LOD0 ≈ 48,000 tris · 4096² + 1024² · 3 slots |
| Audio hooks | voice barks `vo_biscuit_<state>`, 8–12 each: idle sigh-groan, sleep snore, wake "boof", `bark` (single and double; it is also the Sound event), chase excited yips, happy pant loop, sniff snuffles, trapped whine, indignant grumble, dizzy "awoo-wobble", celebrate yip-howl · foley: heavy paw thumps, nail clicks on hard floors, heavy bodyfall, bandana flap, `shake_off` flap-flap |
| Personality | Big-hearted, loud and impulsive. Thinks chasing Mochi is a game they both enjoy. Barges through life and is sorry about none of it. |
| Proportions | head 0.16 m of 0.40 m (40 %), 0.17 wide with a blunt 0.06 m muzzle · eyes Ø 0.030 at (±0.040, −0.27, 0.32) · barrel chest 0.22 wide × 0.24 deep · legs 0.14 (short, stocky) · folded rose ears 0.07 · tail 0.18 plume curling over the back · shoulder 0.28 |
| Signature accessory | Ignition bandana (`kn_fabric_ignition`): a 0.12 m-wide triangle hanging at the chest, centre (0, −0.24, 0.20), knotted at the nape; 2 cloth bones `bandana_01–02` |
| Fur/skin material | `kn_fur_biscuit`: toasted tan `#C98C50` · cream `#F2E3C9` chest, muzzle, socks and tail underside · brown `#7A4F2F` ear tips and brow dots · nose leather `#2D2A2A` (eye set) |
| Face shape keys | ART_BIBLE §8 set (as Mochi) · extras: `sk_tongue_out` (pant), `sk_jowl_puff` (the "boof"), `sk_nose_wrinkle` (sniff) |
| Rig | 45 deform bones: `root`, `hips`, `spine_01–03`, `neck_01–02`, `head`, `jaw`, `tongue_01–02`, `eye_l/r`, `ear_l/r_01–02`, front `scapula/upperarm/forearm/paw/toe_l/r` (10), hind `thigh/shin/hock/paw/toe_l/r` (10), `tail_01–06`, `bandana_01–02` · ragdoll: 15 capsules in Mochi's layout; 12 kg total (hips 2.6, chest 2.4, head 1.4) |
| Clips | `biscuit__` + required: `idle`, `idle_alt`, `walk`, `run`, `chase`, `flee`, `startled`, `tumble`, `getup`, `dizzy`, `trapped`, `celebrate`, `sleep` (sprawled on his side), `sniff` (nose-down trail-tracking walk loop), `emote_happy`, `emote_angry`, `emote_confused` · role: `bark` (0.6 s one-shot; mouth peak on frame 6, aligned with the `EMIT__bark__mouth` event), `bark_run` (additive upper body for barking mid-chase), `wake_startle` (0.5 s sleep-to-standing, ears flip up), `barge` (additive shoulder check), `tail_wag` (additive loop), `shake_off` (1.0 s full-body shake after `getup`; also clears soot) |
| Emotes | `bark` (sound-wave glyph) · `eyes_mochi` (Mochi-ear silhouette) · `zzz` · `!` · `heart` · `bone` · `stars` · `?` |
| Sizes (real scale) | 0.62 m nose to rump, 0.28 m at the shoulder, 12 kg: a stocky medium-small mixed breed |

**Read at a glance.** A low, wide tan dog with a cream chest, a plume tail up over the back and a bright red-orange bandana.
**Notes / don'ts.** He fits the Trap Box standing (interior 0.66 × 0.46 × 0.46 m); his `trapped` clip also plays when he's held by a Tractor Beam or Stasis, or boxed in by Force Walls. Barks are never aggressive: open mouth, happy brow. Chases end in play, never a bite. Original design only: not a white beagle with black ears, not a yellow long-eared dog, not a Great Dane, not a blue or red heeler, not a corgi lookalike (he has a full plume tail, a round skull and folded ears).

---

### HENNY: Highly strung hen who lays when startled
`henny` · Critters · Class XL · Ship M4 · Inspired by (internal only): none

**Concept.** A plump buff hen with a red comb, a cream breast and a Beam ribbon bow at the back of her neck. Anything startles her: she flaps a metre into the air, lays a YOLK mid-panic, looks as surprised as anyone, then takes all the credit. Her silhouette is the egg-shaped body with the comb and fanned tail.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.18 × 0.32 × 0.36 m (to comb top; beak to tail tip; wingspan 0.42 m when flapping) · origin: centre of mass at (0, 0.00, 0.14); `root` on the floor beneath it. Positions are root-space |
| Mass · physics | 1.6 kg · `phys = fur` (overrides: friction 0.8, restitution 0.12) · ragdoll on impacts > 1.2 N·s |
| Collision | animated: `COL__capsule__0` along Y, r 0.08, length 0.24, centre (0, 0.01, 0.13) · ragdoll: `RAG__` set |
| Materials (60/30/10) | neutral: `kn_fur_henny` buff feathers · signature: cream breast + caramel wing tips and tail (texture mask), red comb and wattle · accent: `kn_fabric_beam` bow · eye set on `kn_ceramic_graphite` |
| Ports | none |
| Pivots | none (skinned) |
| Sensors | none authored. AI (`henny.part.json`): startles on Sound or on impacts within 1.5 m → `flap` 1.0 m up (GAME_SPEC §11) → `lay_egg` (cooldown 6 s; max eggs per run is a property); otherwise wanders, pecks and scratches |
| Emitters | `EMIT__look__eyes` (0, −0.12, 0.26) · `EMIT__voice__mouth` (0, −0.15, 0.25) · `EMIT__emote__bubble` (0, −0.06, 0.42) · `EMIT__step__foot_l/r` · `EMIT__egg__vent` (0, 0.10, 0.10) +X → −Z: the YOLK spawns here with the body velocity + 0.2 m/s downward · `EMIT__feathers__body` (0, 0, 0.15): feather puff on startle |
| LEDs / screens | none |
| States | wander → `peck` / `scratch` → startled → `flap` (rise 1 m) → `lay_egg` at the apex → `glide_down` → `proud_puff` → resume · tumble → dizzy → getup · sleep (roost fluff) |
| Animation | baked clips + face shape keys + procedural comb, wattle and bow jiggle |
| Fracture | none, ever |
| Skins / variants | buff (default) · russet (`#9E4A2C`, cream breast) · pearl (`#F1ECE2`, caramel tail). All keep the bow |
| Budget | LOD0 ≈ 40,000 tris (feather clumps) · 4096² + 1024² · 3 slots |
| Audio hooks | voice barks `vo_henny_<state>`, 8–12 each: idle bawk-bawk clucks, content purr-cluck, curious "buk?", startled alarm cackle, flap squawk, egg song ("bawk-bawk-BAGAWK") after laying, proud chortle, indignant squawk, dizzy warble, sleep roost murmur · foley: heavy wing flaps, feather rustle, scratch scrape, peck tick, landing flump |
| Personality | High-strung, theatrical and proud. Startles at everything; lays an egg when she does, is shocked by it, then takes all the credit. |
| Proportions | head (crown to wattle, including the comb) 0.12 m of 0.32 m (38 %, stylised large) · body egg 0.22 L × 0.18 W × 0.17 H · eyes Ø 0.018 at (±0.026, −0.12, 0.26) · beak 0.022 · legs 0.07 visible · comb 0.04 tall, 3 lobes · tail fan 0.08 |
| Signature accessory | Beam ribbon bow (`kn_fabric_beam`), 0.045 wide, at the back of the neck, centre (0, −0.05, 0.22), with two 0.04 m tails on cloth bones `bow_01–02` |
| Fur/skin material | `kn_fur_henny` (sculpted feather clumps): buff gold `#D9A65E` · cream `#F2DFB6` breast and fluff · caramel `#A86F37` wing tips and tail · red `#D6453B` comb and wattle · yellow `#EDB23E` beak and legs (masked regions of the same master; the beak gets roughness 0.35 through the ORM) |
| Face shape keys | ART_BIBLE §8 set (brows are feather tufts) · extras: `sk_beak_wide` (cackle), `sk_feather_fluff` (whole-body fluff for roost and startle), `sk_comb_flop` (comb sags when dizzy or sleepy) |
| Rig | 41 deform bones: `root`, `hips`, `spine_01–02`, `neck_01–04`, `head`, `jaw` (lower beak), `eye_l/r`, `comb`, `wattle`, wings `shoulder/upper/fore/hand/primaries_01–02_l/r` (12), legs `thigh/shin/tarsus/toe_main/toe_back_l/r` (10), `tail_01–03`, `bow_01–02` · ragdoll: 10 capsules: hips, spine_02, neck_02, head, upper wings ×2, thighs ×2, shins ×2; 1.6 kg total |
| Clips | `henny__` + required: `idle`, `idle_alt`, `walk`, `run`, `chase`, `flee`, `startled`, `tumble`, `getup`, `dizzy`, `trapped`, `celebrate`, `sleep`, `sniff`, `emote_happy`, `emote_angry`, `emote_confused` · role: `flap` (0.6 s rise loop with full-span wings; the engine lifts the body 1.0 m), `lay_egg` (0.8 s mid-air squat; the YOLK spawns on frame 18, then a look-back double take), `glide_down` (descending flap loop), `peck`, `scratch`, `proud_puff` (celebrate variant after laying) |
| Emotes | `egg` · `!!` · `feather` (flustered) · `heart` · `stars` · `zzz` · `angry` · `?` |
| Sizes (real scale) | 0.32 m tall, 0.36 m beak to tail, 1.6 kg: a plump hen between bantam and standard size |

**Read at a glance.** A golden egg-shaped bird with a red comb, a fanned caramel tail and a cyan bow at the nape.
**Notes / don'ts.** The YOLK is a separate Roller (rollers.md); Henny never sits on or breaks her own egg on screen. Wings are feather clumps, never thin cards. Her `trapped` pose (wings tucked, indignant) plays standing inside the Trap Box. Its 0.46 m ceiling leaves no room for a 1 m flap, and the bars sit too close for a full 0.42 m wing-beat, so while trapped a startle plays `startled` + the feather puff instead of `flap` (the sim must suppress the rise). Original design only: no knitted hat or scarf, not a rooster, no glasses, no cross-eyed gag face.

---

### DUSTY: Robot vacuum with LED eyes
`dusty` · Critters · Class XL · Ship M4 · Inspired by (internal only): none

**Concept.** The approved look-dev robot vacuum from `style_samples.py` (`dusty()`): a bone disc with a graphite lid, a rubber bumper, two Beam LED eyes under a graphite brow, a power port on top and a single Ignition side brush. It roams its zone, bumps and nudges small things, and happily slurps up sand and marbles, getting heavier and smugger as the bin fills.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.366 × 0.070 × 0.366 m (bumper outer Ø; height to the port ring top) · origin: centre of mass at (0, 0, 0.032); `root` on the floor beneath it. Positions are root-space and match the look-dev builder |
| Mass · physics | 3.2 kg empty + up to 1.8 kg of grains (the bin fill adds mass and lowers speed) · body `phys = powder`, bumper `phys = rubber` (restitution 0.45) · tumbles (rigid) on impacts > 4 N·s or when tipped > 60° |
| Collision | `COL__cylinder__0` Ø 0.366 × 0.055 (z 0.008–0.063) · ragdoll entry `RAG__body` = the same cylinder (rigid, no joints) |
| Materials (60/30/10) | neutral: `kn_powder_bone` body · signature: `kn_powder_graphite` lid, brow strip and underside · accent: `kn_powder_ignition` side brush, Beam LED eye screens, `kn_rubber` bumper and wheels. No `kn_fur_*` |
| Ports | `PORT__power__charge` · in · PR-S · (0, 0.100, 0.064) · facing +Z (approved look-dev). Linked: Dusty roams only while powered (an on/off leash). Unlinked: runs on its internal battery (the default) |
| Pivots | `PIVOT__wheel_l/r` · axis x at (±0.110, 0, 0.022) · continuous · `PIVOT__brush` · axis z at (0.120, −0.080, 0.006) · continuous (6 rps roaming, 12 rps sucking) · `PIVOT__bumper` · axis y, translate 0 to +0.005 m (compresses on contact) · `PIVOT__lid` · axis x, hinge at (0, 0.137, 0.061) · 0–35° (pops on `bin_full`) · `PIVOT__caster` · axis z at (0, −0.120, 0.010) · free |
| Sensors | `SENSOR__intake__suction` · box 0.20 × 0.06 × 0.012 under the body at (0, −0.030, 0.006) · removes Matter grains (sand, marbles) and adds their mass to the bin; never rigid parts or critters · `SENSOR__trigger__bumper` · 180° front arc shell, 0.01 thick, threshold 0.05 N·s → `bump_turn` |
| Emitters | `EMIT__suck__intake` (0, −0.030, 0) +X → +Z: grain-suction swirl · `EMIT__dust__exhaust` (0, 0.170, 0.030) +X → +Y: rear puff on `bin_full` · `EMIT__voice__speaker` (0, −0.120, 0.050) · `EMIT__emote__bubble` (0, 0, 0.18) |
| LEDs / screens | `SCREEN__eye_l` / `SCREEN__eye_r` kind `icon`, color `beam`, 0.026 × 0.012 m at (±0.036, −0.105, 0.061), under `kn_glass` covers (the face) · `SCREEN__bin` kind `bar`, 5 cells, color `beam`, 0.040 × 0.008 m on the lid at (0.060, 0.040, 0.0655): bin fill · LED group 0 `status_ring` (thin light ring around the lid edge) · group 1 `charge` (pip beside the port) |
| States | roam (inside its zone) → `bump_turn` → spot grains → beeline (`chase`) → `suck` → bin fills (heavier, slower) → `bin_full` (stops sucking, lid pop, burp puff, smug eyes) · startled by Sound · tipped → `tumble` → `getup` · `sleep` when unpowered or idle |
| Animation | procedural pivots for every moving piece + a 2-bone armature (`root`, `body`; all pivots are parented under `body`) for clip motion (hops, wobbles, spins) + a `face_icon` custom-property track per clip that drives the eye screens |
| Fracture | none, ever |
| Skins / variants | bone (default, approved look-dev) · graphite "night shift" (graphite body, bone lid) · plasma-lid "future edition" |
| Budget | LOD0 ≈ 16,000 tris (hard surface) · 2048² + 1024² · validated against the XL critter rules (clips, ragdoll entry). The tri count is below the 25,000 XL floor, which the robot-critter note in ASSET_PIPELINE §4 allows |
| Audio hooks | voice barks `vo_dusty_<state>` (synth chirps), 8–12 each: idle 3-note boop, happy arpeggio, curious "bweep?", alarm warble, indignant error buzz, dizzy descending glissando, sleep power-save sigh, celebrate fanfare blip, bin-full burp beep, scan ticks · foley: drive-motor loop (pitch ∝ speed), suction roar (∝ intake rate), bin rattle (marbles clack, sand hisses; ∝ fill), bumper bonk, brush tick, tumble clatter, self-right whirr, lid pop |
| Personality | Dutiful, oblivious neat-freak. Hums while working, gets smug when the bin is full, goes frantic when tipped over. |
| Proportions | robot, so no head ratio: a 0.366 Ø × 0.070 disc (5.2 : 1) · body Ø 0.340 × 0.052 (z 0.008–0.060) · lid Ø 0.250 × 0.008 centred at (0, 0.012, 0.061) · bumper torus R 0.171, r 0.012 at z 0.030 · face band = front 30 % of the lid edge: eyes 0.026 × 0.012 under a graphite brow 0.110 × 0.022 × 0.003 at (0, −0.104, 0.0605) |
| Signature accessory | Ignition side brush (approved look-dev): `kn_powder_ignition` hub Ø 0.044 × 0.006 with 3 rubber-tipped bristle arms at (0.120, −0.080, 0.006), spinning on `PIVOT__brush`. Single and asymmetric on purpose (character) |
| Fur/skin material | none (hard-surface masters only) |
| Face shape keys | none. LED face icons instead: neutral pill, blink line, happy ^ ^, smug half-lid, scared small wobbly o o, angry \ /, dizzy spirals, sleepy – –, surprised O O, determined flat-top, scan (sweeping dot), strain (bulged, for `bin_full`). Visemes become an eye "bounce" on each voice blip |
| Rig | 2 bones (`root`, `body`) + the pivots above · ragdoll: `RAG__body` single cylinder (mass 3.2 kg + bin, swing 0°, twist 0°): a rigid tumble |
| Clips | `dusty__` + required, as robot behaviours: `idle` (blink, slight body tilt), `idle_alt` (brush wiggle, look-around eyes), `walk` (roam), `run` (fast roam), `chase` (beeline to grains), `flee` (reverse and spin away), `startled` (0.02 m hop, O O eyes), `tumble` (rigid), `getup` (upside down: wobble, wheels spin, a little puff tips it upright), `dizzy` (slow spin, spiral eyes), `trapped` (bumping in place, angry eyes), `celebrate` (360° spin, lid pop, happy eyes), `sleep` (eyes – – with "zz", status ring breathing), `sniff` (scan: stops, rotates ±25°, scan-dot eyes), `emote_happy`, `emote_angry`, `emote_confused` · role: `suck` (0.3 s intake gulp shudder), `bin_full` (lid strains and pops, burp puff, bulged eyes), `bump_turn` (bumper compresses, turns 30–150°) |
| Emotes | `sparkle_clean` · `!` · `?` · `bin_full` (bin glyph) · `zzz` · `stars` · `angry` · `heart` |
| Sizes (real scale) | 0.366 m Ø × 0.07 m, 3.2 kg: a real household robot vacuum |

**Read at a glance.** A cream disc with a dark lid, two cyan eyes and one spinning red-orange brush at the front corner.
**Notes / don'ts.** Its roam zone is engine-drawn in Build mode as a dashed bone-coloured floor outline with corner handles. Dusty only removes Matter grains: it nudges rigid parts and never "sucks" a critter (Pip is safe). Robots may have LED eyes (ART_BIBLE §8). Trap Box fit: the Ø 0.366 bumper (approved look-dev, so it doesn't shrink) sits inside the 7 × 5 × 5 cage's 0.66 × 0.46 m floor-level opening (frame.md) with 47 mm clear each side from z 0 to 0.07, inside the 0.466 m between its collision walls. Dusty's `trapped` clip bumps in place without turning. Don't echo a commercial vacuum: no logo, no top button ring, no camera turret.

---

### BUZZ: Ducted courier drone
`buzz` · Critters · Class XL · Ship M5 · Inspired by (internal only): none

**Concept.** Dusty's flying sibling from the same product line: a bone pebble body with four graphite ducted fans, a Beam LED visor face and an Ignition pennant on a whip antenna. Send its beacon a Signal and Buzz zips off, finds the nearest tagged object, grabs it with a winch claw and delivers it to the beacon with a proud little bow. Hit it and it tumbles, rights itself and insists on finishing the job.

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.34 × 0.085 × 0.34 m (span across the ducts; skids to the body top at the antenna base; the whip antenna reaches z 0.145) · origin: centre of mass at (0, 0, 0.055); `root` on the ground beneath it when landed (skids at z 0). Positions are root-space |
| Mass · physics | 1.1 kg · payload ≤ 2 kg (spec) · `phys = powder`, duct lips `phys = rubber` · on impacts > 3 N·s (SIMULATION §7.3): rotors cut, rigid tumble, then `getup` and relaunch |
| Collision | `COL__box__0` body 0.14 × 0.12 × 0.06 at z 0.055 · `COL__cylinder__1..4` ducts Ø 0.11 × 0.035 at (±0.115, ±0.115, 0.066) · `COL__box__5` skids · ragdoll entry `RAG__body` (single hull, rigid) |
| Materials (60/30/10) | neutral: `kn_powder_bone` body shell · signature: `kn_powder_graphite` ducts, skids, chassis and claw · accent: `kn_fabric_ignition` pennant, Beam visor screen, LEDs, `kn_rubber` duct lips and claw pads. No `kn_fur_*` |
| Ports | none on Buzz (its Signal input is on the paired beacon; see Notes) |
| Pivots | `PIVOT__rotor_fl/fr/bl/br` · axis z at (±0.115, ±0.115, 0.066) · continuous (fl and br clockwise, fr and bl counter-clockwise; blur-disc swap above 20 rps) · `PIVOT__visor` · axis x at (0, −0.055, 0.075) · ±12° (nods) · `PIVOT__winch` · axis z, translate 0 to −0.60 m at (0, 0, 0.022) (the tether is an engine rope, `kn_rope` Ø 3 mm) · `PIVOT__claw_a/b/c` · tangent axes at 120° around the claw hub · 0–40° open |
| Sensors | `SENSOR__catch__claw` · sphere Ø 0.06 at the claw (rides the winch) · grabs a tagged body ≤ 2 kg on contact. Critters can't be tagged |
| Emitters | `EMIT__downwash__rotor_fl/fr/bl/br` +X → −Z: dust and leaf kick within 0.4 m of a surface (cosmetic; no Air channel) · `EMIT__spark__duct` (on hard hits) · `EMIT__voice__visor` (0, −0.062, 0.065) · `EMIT__emote__bubble` (0, 0, 0.20) |
| LEDs / screens | `SCREEN__face` kind `icon`, color `beam`, 0.070 × 0.025 m at (0, −0.061, 0.068) behind a `kn_glass` visor · LED group 0 `nav` (2 white `#EEF1F6` domes on the front duct faces + an amber rear strobe at (0, 0.062, 0.060)) · group 1 `ducts` (white `#EEF1F6` ring inside each duct lip, ∝ thrust; never a player colour, see Notes) · group 2 `cargo` (ring on the claw hub, signal colour while carrying) |
| States | docked on its beacon (rotors off, visor "zz") → beacon Signal → `takeoff` → `sniff` scan for the nearest tagged object → fly (`walk` / `run`) → `grab` → `carry` (loaded hover, sags with mass) → `drop_off` (winches the item down onto the pad and releases it) → `deliver_bow` → docks once the pad is clear; if the item stays on the pad, Buzz `land`s on the floor beside the beacon · hit → `tumble` → `getup` → resume · nothing tagged → "?" emote and `land` |
| Animation | procedural pivots + a 4-bone armature (`root`, `body`, `pennant_01–02`; pivots parented under `body`) + a `face_icon` track per clip |
| Fracture | none, ever |
| Skins / variants | bone (default) · graphite "night courier" · amber "express" (amber body shell). All keep the ignition pennant |
| Budget | LOD0 ≈ 22,000 tris · 2048² + 1024² · validated against the XL critter rules. The tri count is below the 25,000 XL floor, which the robot-critter note in ASSET_PIPELINE §4 allows |
| Audio hooks | voice barks `vo_buzz_<state>` (synth chirps), 8–12 each: acknowledgement double-beep ("on it!"), curious scan trill, delivery jingle (3-note), alarm whoop, strained whine (heavy load), indignant buzz, dizzy warble, sleep power-down, celebrate roll fanfare · foley: 4-rotor whir loop (pitch ∝ thrust and load), spin-up and spin-down, winch reel, claw clack, impact plink, tumble clatter, landing tap |
| Personality | Eager to please, punctual and a little officious. Treats every delivery as a sacred duty; flustered when hit, then determined to finish. |
| Proportions | robot · body pebble 0.14 W × 0.06 H × 0.12 D · ducts Ø 0.11 outer × 0.035, centres ±0.115 · visor face 0.07 × 0.025 = 50 % of the body's 0.14 m front width · skids 0.012 tall · claw hub Ø 0.03, tucked under the body at z 0.012 when retracted |
| Signature accessory | Ignition pennant (`kn_fabric_ignition`, matching Dusty's Ignition brush) 0.05 × 0.03 on a 0.06 m graphite whip antenna at the rear-top, base (0, 0.050, 0.085), tip z 0.145; flutters with airspeed on `pennant_01–02` |
| Fur/skin material | none (hard-surface masters only) |
| Face shape keys | none. LED visor icons share Dusty's set (neutral, blink, happy, smug, scared, angry, dizzy, sleepy, surprised, determined, scan, strain) drawn wider for the visor, + `PIVOT__visor` nods. Visemes become an eye bounce |
| Rig | 4 bones + the pivots above · ragdoll: `RAG__body` single hull (1.1 kg + payload, rigid) |
| Clips | `buzz__` + required, as drone behaviours: `idle` (0.01 m hover bob, blink), `idle_alt` (yaw look-around, pennant flick), `walk` (cruise, 10° bank), `run` (dash, 20° bank), `chase` (pursue the target), `flee` (back off and climb), `startled` (0.05 m jolt up, O O eyes), `tumble` (rigid, rotors cut), `getup` (on the floor: wobble upright, spin up, lift), `dizzy` (wobbly circles, spiral eyes), `trapped` (straining against a hold), `celebrate` (360° barrel roll), `sleep` (on the beacon, rotors off), `sniff` (scan sweep for tags), `emote_happy`, `emote_angry`, `emote_confused` · role: `takeoff`, `land`, `grab` (descend, claw closes), `carry` (loaded hover loop), `drop_off` (release over the beacon), `deliver_bow` (little dip) |
| Emotes | `package` · `pin` (destination) · `check` · `!` · `?` · `stars` · `zzz` · `clock` (on time) |
| Sizes (real scale) | 0.34 m span, 1.1 kg: a small consumer drone (the 2 kg payload is toy-world physics) |

**Read at a glance.** A cream pebble on four dark rings with a glowing cyan visor and an orange-red flag streaming behind.
**Notes / don'ts.** Companion type `buzz_beacon` (`critters/buzz_beacon.blend`, Class S, ≈ 2,500 tris, 1024², ships with Buzz). It is a Ø 0.20 × 0.040 graphite landing pad (2 × 0.4 × 2 cells, static) on 4 mm rubber feet, sized so Buzz's 0.14 × 0.12 skid footprint lands with margin. It has an LED ring (group 0) in the Buzz ↔ beacon pair colour (default ignition), a Buzz-glyph decal in the centre, and `PORT__signal__call` (in, PR-S, at (0, −0.100, 0.022) facing −Y, on a 0.036 × 0.036 flat at the front edge). `EMIT__land__pad` (0, 0, 0.040) is the landing target. Device RIG `buzz_beacon_rig` (ASSET_PIPELINE §3.9): `root` + `socket_dock` at (0, 0, 0.040) with +X pointing −Y, so Buzz docks facing the port side; Buzz's `root` binds there when docked. Tagged objects show an Ignition tag glyph in Build mode (engine UI). Multiplayer: the partner drone (ui_icons.md `mp_drone`) is a Bone pod with player-coloured duct rings, so Buzz never carries Plasma or Beam on its ducts, nav lights or pennant. The Beam visor face stays because it's shared with Dusty and the partner drone has a lens, not a face. All props are ducted: no exposed blades. No camera lens or anything that reads as surveillance. Not a real-brand drone shape.
