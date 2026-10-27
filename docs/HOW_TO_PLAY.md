# How to play KNOCK-ON

*Every action has an overreaction.*

KNOCK-ON is a sandbox for building ridiculous chain-reaction machines in 3D, alone or with a friend. Place parts, connect them, hit **LET IT RIP**, and watch the cascade. Hit **Stop** and everything snaps back so you can tweak and try again.

> This manual describes the game as it ships in the **M5 beta**. A few things the design ([GAME_SPEC.md](../GAME_SPEC.md)) plans aren't in the beta yet; §13 lists them, so nothing here promises a key that does nothing.
> Local two-player setup: [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md).

**Contents:** [1 Quick start](#1-quick-start) · [2 The screen](#2-the-screen) · [2½ Worlds](#2-worlds-and-environments) · [3 Building](#3-building) · [4 Connecting things](#4-connecting-things-channels) · [4½ Matter](#4-matter-sand-water-marbles-and-goo) · [5 Running](#5-running-your-machine) · [6 Playing together](#6-playing-together) · [7 Saving and sharing](#7-saving-sharing-and-capture) · [8 Controls](#8-controls-reference) · [9 Parts glossary](#9-parts-glossary) · [10 Recipes](#10-starter-recipes) · [11 Settings](#11-settings-and-comfort) · [12 Problems](#12-if-something-goes-wrong) · [13 Not in the beta yet](#13-not-in-the-beta-yet)

---

## 1. Quick start

1. Open the game URL (your own, or the one your host sent you). On a first visit, open `/check` to make sure your browser and GPU are ready.
2. You start in your last world. For a fresh one, open **Menu › Worlds & lobby**, pick **New World → Room** and **CREATE WORLD** (or join your friend's live session). Desk and Room worlds open in **THE TINKER LAB**, a sunny classroom workshop.
3. Your first machine, in about a minute:
   - Press **6** (SLOPE) and click on the cutting mat to place a ramp. Press **R** first to turn it if you like (15° a press).
   - Press **1** (THUD, the heavy ball) and click on the high end of the SLOPE: a part sits on top of whatever you point at.
   - Press **L** for the Library, type `stomp`, click **STOMP PAD**, then click on the floor just past the bottom of the ramp, where THUD will roll.
   - Press **0** (BANGSTICK) and click right next to the pad.
   - Press **E** (Wire). Click the pad's yellow **Signal** ring, then the BANGSTICK's yellow ring: a cable joins them. (A BANGSTICK needs fire, a signal or a nearby blast; a ball alone won't set it off.)
   - Press **Space**: **LET IT RIP**.
4. Press **Space** again to pause, **Backspace** to stop and go back to building. Everything resets exactly.

---

## 2. The screen

The panels are frosted glass floating over the world (turn on **Reduce transparency** in Settings for solid panels).

```
 top left    world card: name, size · parts, saved, undo ↶ / redo ↷, environment, gravity and air
 top right   session bar: your friend · BUILD │ RUN · Save · Share · Ctrl K · Menu
 left        view rail: orbit, pan, zoom · normal, X-ray, section · cutaway · Outliner (Ctrl+\)
 centre      the 3D world
 right       Inspector: slides in when you select something (sliders, toggles, sections)
 bottom      parts tray: family tabs, search, big part icons (the first ten are keys 1–0)
             above it the transport: Reset · step back · ( LET IT RIP ) · step forward · speed
 during a run: who started it and the camera (top left), K.O. count (top centre),
             events (top right), and the run bar: timeline, pause, speed, Bake & Watch, camera, Stop
```

- **Library** (**L**): every part, organised by family, with search, channel filters, favourites (**F** on a card) and your saved modules. Hover a card for *Needs / Does* and tips.
- **Command palette** (**Ctrl/⌘ K**): type anything ("section", "tag", "moon", "settings", a part's name).
- **Radial menu** (hold **Q** over a part, point at a wedge, let go): Rotate 90° · Duplicate (arms the same part, same rotation) · Connect (Wire tool) · Anchor · Lock · Inspect · Library · Delete. It opens at the mouse pointer and acts on the part you held Q over, even when you point across other parts. Let go over the centre to cancel. A quick tap of Q leaves it open instead: then the arrow keys choose and Enter confirms (§3.8).
- **Menu** (top right): Settings, Worlds & lobby, Library, Cascade Report, Keyboard shortcuts, Reset the hotbar, Clear world.
- **Matter meter** (world card, when the world has sand, water or marbles): how many particles your machine starts with against your GPU tier's budget, for example `230k / 4M grains`. It turns amber near the limit, and red with "needs 16 GB" when the machine is too big to run here. It says **Matter off** when the world's Matter switch is off (§4½).

---

## 2½. Worlds and environments

A world has a **size** (chosen when you create it) and an **environment** (the set around the build zone; change it any time in **Settings › World**, or the palette: "Environment: …"). Changing the environment is shared with your partner and undoable.

| Size | Footprint | Environments |
|---|---|---|
| Desk | 4 × 3 m | The Tinker Lab, the Studio |
| Room | 16 × 16 m | The Tinker Lab, the Studio, Mega Kitchen, Moon Base |
| Warehouse | 64 × 64 m | the Studio, Mega Kitchen, Orbital Hangar, Moon Base |
| Arena | 256 × 256 m | the Studio, the Backlot, Orbital Hangar, Moon Base |
| Megastructure | 1 km | the Backlot, the Studio |

- **THE TINKER LAB:** a warm science-classroom workbench (the default for Desk and Room).
- **The Studio:** a clean, neutral backdrop.
- **Mega Kitchen:** a giant kitchen counter. **Fill the sink** (Settings › World) starts runs with a million particles of water in the sink (needs the 16 GB tier).
- **The Backlot:** an outdoor lot with terrain you can sculpt (the tray's **Terrain** tab: raise, lower, flatten, smooth).
- **ORBITAL HANGAR:** a space-station hangar at **38 % gravity**. Glowing rings on the deck are **zero-g zones**: anything inside one floats. **Settings › World › Zero-g zones** switches them all off or on (they can't be moved).
- **MOON BASE:** **16.5 % gravity and no air**. With no air, HELIOs sink and GALEs, PUFFERs and other fans push nothing. Things fly a long way.

Switching to the Hangar or the Moon also sets its gravity and air, unless you had changed them yourself (then yours stay). The world card shows the current values.

**Weather** (Settings › World, any environment): a wind that pushes light and large parts and leans HELIOs, and blows out flames above 4 m/s. Pick *Calm*, *Breezy* (3 m/s), *Gusty* (6–10 m/s) or *Overcast* (2 m/s), or set the speed and the direction yourself. Gusts are seeded, so a run replays exactly; with no air (the Moon) there's no wind.

---

## 3. Building

### 3.1 Placing parts
- Pick a part from the **parts tray** (**1–0**, or click a tile), the **Library** or the palette, then click in the world to place it. You can also drag a tray tile into the world.
- The ghost sits on top of whatever you point at (the floor, the work plane, or another part's top) and snaps to a **10 cm grid**; hold **Shift** for 2.5 cm.
- **R / T / Y** rotate the ghost 15° around yaw / pitch / roll before you click (add Shift to go the other way).
- A **red ghost** means it would overlap a part; clicking says which one. The part stays armed, so you can place several; pick another tool (**V**, **E**, **P**) when you're done.
- **Port snap:** bring a part's port within 5 cm of a matching port (same channel; an output to an input for Signal and Power; a port with room for another link) and the ghost jumps so the two line up, socket to socket with the parts just touching. Matching ports nearby glow in their channel colour and the one it joins pulses. It works for dragging and pasting too. Hold **Alt** to place freely; Settings › Controls › **Snap to ports** switches it off. It only nudges a few centimetres, so raise the work plane (Ctrl + wheel) to reach a port high on a part.

### 3.2 Work plane
When nothing is under the cursor, parts land on the **work plane** (the floor to start with). **Ctrl + mouse wheel** raises or lowers it in 10 cm steps (palette: "Work plane to floor" puts it back). With the keyboard cursor, **PageUp / PageDown** do the same. They also work in the middle of a drag: the dragged part rides on the plane, and a raised plane hides what's under it, so you can lift a part over others (§3.3).

### 3.3 Selecting and editing
- **V** Select tool. Click to select; **Shift** or **Ctrl + click** adds or removes. The selected part's **Inspector** opens on the right.
- **Box select:** in the Select tool, hold **Shift** and drag on empty floor to draw a box; every part whose middle is inside is selected (a TUBE when all of it is inside). Hold **Ctrl** instead to toggle the parts in the box. Locked and hidden parts are skipped. The badge counts as you drag, and "5 parts selected" shows when you let go. A plain left-drag on empty space follows the view rail (Orbit, Pan or Zoom), and right-drag always orbits.
- **Drag a part to move it.** Press on a part and drag. A click that hardly moves still just selects. If the part is in your selection, the whole selection moves together; otherwise that part is selected and moves alone. While you drag, the parts show as see-through ghosts where they'll land. They snap to the 10 cm grid and sit on whatever is under the cursor, and wires, LINEs, BANDs and FUSEs stay attached. Release to drop; **Esc** or a right click puts everything back. Red ghosts mean the drop would overlap a part (or leave the world). The badge says why, and letting go there moves nothing. One drag is one Ctrl+Z.
  - **While dragging:** **Shift** moves straight up and down. **Alt** moves freely, off the grid. **Ctrl** snaps to 2.5 cm. **R / T / Y** turn the part (with several parts, R turns them all). The badge by the cursor shows the height ("1.2 m").
  - **Lifting:** **Ctrl + wheel** (or PageUp / PageDown) raises the work plane mid-drag, and the part rides on it. A thin stalk shows its height above the floor. To hang a TRAP BOX, drag an **ANCHOR**, roll Ctrl + wheel up to 2.5 m, drop it over the TRAP BOX, then wire a **LINE** (E) from its hook down to the box's hook.
  - **Can't be dragged:** locked parts and parts on locked layers (the reason shows), parts your friend is holding, and anything during a run. Anchored parts can be dragged: anchoring only matters in the run.
- **The gizmo** (on by default, **A** shows or hides it; palette: "Gizmo") sits on the selection in the Select tool:
  - **Arrows** move along X, Y or Z. **Squares** move in a plane. **Rings** turn the selection: 15° steps, Shift = 5°, Alt = free. The rings turn the same angles as R / T / Y, and several parts turn about their middle.
  - On a ZONE, FORCE WALL or STASIS FIELD, the **corner cubes** resize it.
  - Handles keep their size at any zoom, grow and change the cursor under the pointer, and wear X / Y / Z letters. A readout by the cursor shows the change (Δ position, angle or size).
  - **X** switches the arrows and squares between **world** axes (the default) and the part's **local** axes (palette: "Gizmo: local axes"): in local mode they follow the part's own turn, so a PLANK at 30° slides along its own length in whole grid steps. With several parts selected, local means the Inspector's part.
  - The same snapping, red "blocked" refusal and one-step undo apply as for dragging. Pressing a part where a ring crosses it still drags the part.
- **Move with the keyboard:** the arrow keys (keyboard building aids, on by default: one grid step, Ctrl = 2.5 cm, PageUp / PageDown up and down), or type its position (in 10 cm cells) in **Inspector › Transform**. **R / T / Y** rotate the selection 15°.
- **Resize** ZONE, FORCE WALL and STASIS FIELD by dragging the gizmo's corner cubes, or with the gizmo off the blue handles on their sides (the opposite side stays put; Alt drags without snapping), or press **Shift + =** / **Shift + −** to grow or shrink them a step. The Inspector has the exact sizes.
- **Del** deletes · **Ctrl+G** groups (Ctrl+Shift+G ungroups) · **Ctrl+L** locks · **H** hides (the Outliner shows it again) · **Anchored** (Inspector) pins a loose part in place.
- **Ctrl+Z / Ctrl+Shift+Z** undo / redo (500 steps; in multiplayer it only undoes *your* changes).
- **Copy and paste:** **Ctrl+C** copies the selection with the wires, LINEs, BANDs and FUSEs between its parts (and any TUBE you selected). **Ctrl+V** puts a see-through copy under the cursor: move it like a dragged part (it rests on what's under it, R turns it, red means blocked) and **click** to drop it; Esc or a right click cancels. The copy is selected, ready to move. The clipboard lasts until you close the tab, so you can paste into another world. Copied RIFT GATES, BUZZ + BEACON and PING pairs become a **new** pair of their own colour; a single copied gate or BUZZ pairs up as if you had just placed it.
- **Duplicate:** **Ctrl+D** copies the selection right next to itself (it steps along until the copy has room) and selects the copy. To copy a whole gadget into the Library, save it as a module (§3.6); the radial menu's (Q) **Duplicate** still arms the part under the cursor.
- **Mirror:** **Alt+X**, **Alt+Y** or **Alt+Z** flips the selection across its middle (left ↔ right, up ↔ down, front ↔ back). Parts turn into their mirror image when they have one (most blocks, balls, planks, ramps, critters). A part with a handed shape (MOTOR, GALE, a TORCH…) can't be mirrored, so it keeps its turn and only moves to the mirrored spot; the message names it. A mirror that would hit a part outside the selection is refused. Ctrl+Z undoes copy, paste, duplicate and mirror in one step each, and your friend sees them at once.

### 3.4 Drawing and wiring
| Tool | Key | Use it for |
|---|---|---|
| **Path** | P (Shift+P: slim) | **TUBE** runs: click points along the way (each sits a tube's radius above what you click); **Enter** or a double-click finishes. A slim TUBE takes marbles. |
| **Wire** | E | Click one port ring, then another. The link matches the channel: Signal and Power **cables**, a **FUSE** between Heat ports, a **LINE** between Tension ports, a **BAND** between Spin ports. Click empty space between the two to route it through waypoints (a FUSE burns along its whole route). |
| **Terrain** | tray › Terrain | Backlot worlds only: raise, lower, flatten, smooth |

### 3.5 Seeing inside big builds
- **Hold Tab** (from the 3D view) for **X-ray**: art dims and every connection lights up by channel (see §4). The view rail has X-ray too.
- **Section** (view rail, or the palette) drags out a box; only what's inside it is shown. Drag its handles; Enter or Esc finishes.
- **Cutaway** (view rail) cuts away shells and walls facing the camera.
- **Ghost trails:** after a run, faint trails show where things went (until your next edit; palette: "Clear ghost trails").
- **Outliner** (**Ctrl+\\**): every part in a tree of layers and groups, with show / hide and lock per row; double-click a row to frame it.

### 3.6 Modules
Select a gadget you're proud of → palette → **Save selection as module**. It appears in **Library › Modules**, where you can place it (R turns it 90°), rename it, export it as a `.knockmod` file, or import one. In multiplayer, modules are shared with your friend.

### 3.7 Future Tech helpers
- **Pairs (RIFT GATES, BUZZ BEACON, BUZZ):** pairing is by **colour** (Plasma, Beam, Amber, Volt, Cobalt, Ignition). Two RIFT GATES of a colour form a pair (if there are more, 1st + 2nd, 3rd + 4th…); a BUZZ docks on the first free BUZZ BEACON of its colour. The Inspector shows the colours by name with how many of each there are, and says what this part is paired with ("No twin yet" if nothing). When you select one, a dashed line joins it to its partner (hold Tab for X-ray to see every pair). **Placing pairs itself:** a new gate takes a colour that has one gate, so two placed in a row are a pair; a new BUZZ takes the colour of a beacon that has no BUZZ.
- **GRABBER zones:** select the GRABBER, then **Inspector › Zones A and B › Point zone A** and click where it should pick things up (or press Enter at the keyboard cursor); **Point zone B** for where it puts them down. Clicking a loose part (a STITCH, a BOING) points the zone at where that part rests: its middle, at the height it sits on, so the arm reaches down around it. Clicking a LEDGE, a shelf or the floor uses the spot you clicked. The arm's reach is 12–30 cm and 0–20 cm up; a point further away is pulled in to its reach. Both zones show as rings with **A** and **B** tags while the GRABBER is selected, and their direction, reach and height are in the Inspector.
- **Tagging for BUZZ:** select a loose part and switch on **Inspector › Tagged for BUZZ** (or palette: "Tag selection for BUZZ"). Tagged parts wear an amber **tag** badge in the world and in the Outliner. BUZZ only carries up to **2 kg**; the Inspector says when a part is too heavy. Critters can't be tagged.

### 3.8 Building with the keyboard
Everything works without a mouse (Settings › Accessibility › **Keyboard building aids**, on by default):
- **Choose a part:** 1–0, **[ / ]**, the parts tray (Tab to it, arrows along the tiles, Enter), or the command palette (**Ctrl K**, type a name, Enter).
- **The keyboard cursor:** press an **arrow key** and a cursor appears in the world where the camera is looking. Arrows move it one grid step (10 cm), relative to the camera (↑ is "away from me"); **Ctrl + arrows** move 2.5 cm; **PageUp / PageDown** raise and lower the work plane. The ghost, snapping and the red "blocked" tint follow it exactly as they follow the mouse, and the tool badge next to it lists the keys. Move the mouse over the world and it takes over again.
- **Place:** **Enter** places the armed part at the cursor; **R / T / Y** rotate it first.
- **Select and move:** **V**, then **[ / ]** pick up the nearest parts in turn (or Enter on the part under the cursor). While a part is picked up, the arrows move it and PageUp / PageDown lift it; **Enter** puts it down, **Del** deletes it, **Shift + = / −** resizes a ZONE, FORCE WALL or STASIS FIELD.
- **Wire:** **E**, then **[ / ]** jump the cursor from port to port (nearest first; each port's name and channel are read out), **Enter** on the first port, **[ / ]** to the second, **Enter** to connect.
- **GRABBER zones:** after Inspector › Point zone A (or B), move the cursor and press **Enter**; Esc cancels.
- **Pairs, tags and sizes** are Inspector controls: Tab into the Inspector; arrow keys move between pair colours.
- **Camera:** **Shift + arrows** orbit and tilt, **= / −** zoom, **F** frames the selection.
- **Panels:** **Tab** from the world moves into the panels (Tab / Shift+Tab move between controls; the arrow keys move inside a row of tabs, segments or tiles); **Esc** closes the top panel and then hands the keys back to the world. A quick tap of Tab moves focus; *holding* Tab still peeks in X-ray. Dialogs keep Tab inside them until you close them.
- **Radial menu:** a tap of **Q** opens it (at the keyboard cursor, or at the mouse pointer); arrows choose a wedge, **Enter** confirms, **Esc** or Q closes it. Holding Q with the mouse over the world works as usual: point and let go.
- **Outliner:** **Ctrl+\\**, then Tab into the tree: ↑ ↓ move, → ← open and fold groups, Enter selects (Ctrl+Enter adds), **H** hides, **L** locks.

---

## 4. Connecting things: channels

Every part talks through **channels**. Look at a part's **port rings**: their LED colour tells you the channel. On part cards, **Needs** lists inputs and **Does** lists outputs. Anything that *emits* a channel works with anything that *receives* it.

| Channel | Glyph | Colour | How things connect | Example |
|---|---|---|---|---|
| **Impact** | ✸ | white | By touching: hit, push, land on | THUD knocks over TOPPLE TILES |
| **Signal** | ◆ | yellow | Wires (E), or a paired PING | STOMP PAD → PUNCHLINE fires |
| **Spin** | ⟳ | violet | Cogs mesh by touching; a BAND (E) joins two spin ports | MOTOR → BAND → TREADWAY |
| **Tension** | ∿ | tan | A LINE (E) between tension ports, routed over SHEAVEs | HELIO lifts an empty SCOOP |
| **Power** | ⚡ | lime | Power cables (E). Sources have a watt budget | MAINS → MOTOR, LAMP |
| **Light** | ☀ | pale gold | Line of sight; MIRRORs bounce, BURNING GLASS focuses | TORCH → SUNCELL makes power |
| **Heat** | 🔥 | orange | Touching a flame, a FUSE (E), or focused light | WICK lights a FUSE |
| **Air** | ≋ | mint | Wind cones from fans and blowers (none on the Moon) | GALE spins a TURBINE |
| **Fluid** | 💧 | blue | Sand and water flowing and pooling | TANK turns a WATERWHEEL |
| **Sound** | ♪ | pink | Loud things within earshot | RINGER wakes BISCUIT the dog |
| **Lure** | ◎ | green | Critters move toward what they want | Seeds pull PIP the hamster |
| **Field** | ⊛ | magenta | Invisible force zones | GRAV WELL pulls PIG IRON in |

**Status LEDs:** dim = idle, lit = active, pulsing = flowing. A jammed gear train sparks and flashes; that means two motors are fighting.

**Port glyphs:** while you wire (E), in X-ray, and on the part you point at, every port also shows its channel's **glyph** on a little dark badge (outputs have a solid ring, inputs a dashed one), so you never have to tell channels apart by colour alone. Settings › Accessibility › Port glyphs turns them off; the colour presets (§11) change the colours.

---

## 4½. Matter: sand, water, marbles and goo

Sand, water, marbles and goo are real: millions of grains that pour, pile, splash and push. They are simulated exactly, so an avalanche plays out the same way on every run and on both players' screens.
- **Dispensers:** **GRIT HOPPER** (sand) and **MARBLE HOPPER** (marbles) open and close their gate on each Signal; set *Capacity*, *Rate* and how *full* they start in the Inspector. **TANK** holds 15 L of water behind a valve (*Flow* sets the litres per second). **SPRINKLE CAN** pours when it's tipped. **GOO VAT** holds 9 L of green slime behind a valve: each Signal opens or closes it, and goo dropped into its lid hatch is soaked back up.
- **Things Matter moves:** a **WATERWHEEL** turns when water or sand fills its buckets (Spin out on its axle). A **SPONGE** soaks up water and gets heavier, and squeezes it out again under a heavy part or a hard hit. Grains push light parts, water floats a **QUACK**, and a **SCOOP** that catches Matter gets heavier.
- **HOURGLASS** is a timer, not grains: tip it and the sand runs for its *Duration*, then it signals.
- **DUSTY** the robot vacuum patrols a zone and sucks up sand and marbles (§9). Select Dusty and use **Inspector › Patrol zone › Draw the zone on the floor**: drag a rectangle (or press Enter at two corners with the keyboard cursor). The zone shows as a dashed mint outline while Dusty is selected; its numbers are under the button.
- **The Matter switch:** **Settings › World › Sand, water and marbles** turns grains on or off for the whole world (shared, undoable). Off, containers still open, empty and signal on time, but nothing pours, which is lighter on the GPU. Worlds saved before Matter existed start with it off.
- **How much fits:** every tier has a grain budget (250k on 4 GB, 1M on 8 GB, 2M on 12 GB, 4M on 16 GB, 8M on 32 GB). The world card's Matter meter shows what your containers hold at the start. A machine over the budget doesn't run on that tier ("Needs 16 GB tier"); it never runs differently.
- **Big pours can run slower than real time:** like any huge machine, a big avalanche can show **SIM 0.6×**. Turn on **Bake & Watch** to pre-simulate and watch it smoothly.
- **Goo** is thick and sticky: it oozes, strings and drips, slows anything that rolls through it, and nothing floats in it.
- **Low gravity:** grains follow the world's gravity: they fall slowly on the Moon and in the Hangar, and float inside the Hangar's zero-g rings. Wind doesn't move grains.

---

## 5. Running your machine

| Action | Key |
|---|---|
| **LET IT RIP** (start) | Space |
| Pause / resume | Space |
| Stop and return to building (everything resets exactly) | Backspace (or Esc when no panel is open) |
| Step back / forward one tick | , / . |
| Jump back / forward 1 s | ◀◀ / ▶▶ in the run bar |
| Speed slower / faster (0.1×–4×) | − / = |
| Scrub / rewind | Drag the timeline |
| Poke: press THE BUTTON | Click it |
| Poke: shove a loose part away from you | Ctrl + click it |
| Solo preview (multiplayer: only you see it) | Shift+Space |

- **Timeline markers** show events by channel colour.
- **K.O. Count** counts each distinct knock-on step: one part setting off another (a THUD knocking a domino, a DELAY firing a BANGSTICK). Each pair of parts counts once. The counter at the top and the Cascade Report count the same thing, so they match at the end of the run. While you scrub, the counter shows the count up to that moment.
- **SIM 0.4×** in amber means your machine is too big for real time. It's still exact, just running slower. Turn on **Bake & Watch** (run bar) to pre-simulate and then watch it smoothly at any speed.
- After a run, the **Cascade Report** shows your longest chain step by step, the channels and parts used, the biggest boom, and your **Overreaction Score**. Click any step to jump there. During a run it jumps at once (a step not simulated yet is reached as soon as the simulation gets there). After the run, it replays the machine to that moment and pauses there, and the report stays open so you can click the next step. **REPLAY**, **Share card** (an image of it) and **Record clip** (the capture dialog, §7) are always at the bottom of the report; a long chain scrolls above them.
- **Captions** (Settings › Accessibility): sounds and big moments appear as text above the run bar, like `[BOOM] POWDER KEG ×6`, `[crash] PANE breaks`, `[vwoom] a THUD warps through RIFT GATES` or `[Buzz delivers a THUD]`, with a small arrow (‹ ›, or ◂ ▸ when it's off screen) pointing towards where it happened. Critters showing an emote also get it in words ("Mochi: alarmed!", "Buzz: got it!"). Screen readers hear the captions too.

### Cameras
| Camera | Key | |
|---|---|---|
| Orbit | right-drag; middle-drag pans; wheel zooms | Default while building. The view rail sets what a left-drag does (orbit, pan or zoom) |
| Focus selection | F (or double-click a part in the Select tool) | Frames the selected parts, or the part you double-clicked. Stop returns the view to where you were before the run |
| Director (auto shots), Ride (rides a moving part), Overview | C cycles them; or the run bar's camera buttons | Any orbit input hands back to Orbit |
| Photo mode | F10 | Hide the UI, depth of field, stills up to 8K |

---

## 6. Playing together

Two players build the same world at the same time, then watch the same run. The first player to join is the **host**; see [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md).

**Seeing each other**
- Your friend's camera is a little **drone** in their colour (Player 1 cyan, Player 2 magenta), and their cursor shows in the world with their name.
- When they hold a part, it's **locked** to them until they let go.
- While they drag, turn or paste something, you see it as see-through ghosts in their colour, turned the way they're turning it (up to 32 parts), and their tag says "holding PLANK" or "holding 5 parts". Only the drop changes the world.

**Talking**
| Action | Key |
|---|---|
| Chat | / to open, Enter to send |
| Ping "look here" | G |

**Running together**
- Either of you presses **LET IT RIP**, which starts a **3-second countdown** on both screens. Either of you can cancel it with Esc.
- You both see the same moment. Pause, speed and scrubbing from either player apply to both (a toast says who did it). **Cameras are your own.**
- **Pokes** work for both of you. They land a moment after you make them, so both machines stay in perfect sync.
- If one PC is slower, playback waits for it.
- Either player can **Stop**. Both go back to building.
- **Solo preview** (Shift+Space) runs only on *your* screen, so your friend can keep building.

**Good to know**
- Undo only undoes your own changes. If your friend has since moved the same part, that undo step is skipped.
- The world's size limit is set by the *less powerful* of your two GPUs. The lobby shows the session tier.
- World settings (environment, gravity, zero-g zones, weather, the Matter switch) are shared; graphics, performance and accessibility settings are your own. Your physics thread count never changes what happens (§11).
- If your connection drops briefly, you'll rejoin where you left off without losing edits.

---

## 7. Saving, sharing and capture

- **Autosave** is on all the time (on the host in multiplayer); **Save** in the session bar saves right away.
- **Share link** (⧉ Share): small machines fit entirely in a link; bigger ones are stored on the host. Send it, and your friend sees the same run, because the machine *is* the replay. Paste a link in the Share box to open one.
- **Clips:** **Record clip** in the Cascade Report (or **Shift+F10**) opens the capture dialog. It asks for the camera (the director, your current view, or a camera path saved in Photo mode), the start and end time, resolution, frame rate and format (**MP4**, **GIF** or animated **WebP**), and estimates the render time (the estimate learns from your own renders, so it gets closer after the first clip). The game then renders the clip offline, frame by frame from the baked run at full quality, so it's perfectly smooth even if your PC couldn't play it in real time. The **director** camera cuts in the clip exactly as it does live, from the clip's start. Clips come out at exactly the size you pick (1080p is 1920 × 1080). MP4 clips carry the game's sound too, rendered along with the frames. A progress bar has **Cancel**; the finished clip has a preview and **Save**.
- **Photos:** **F10** opens **Photo mode**: the UI hides, and a small panel on the left sets the camera orbit, focal length, aperture (depth of field), exposure, the colour grade (LUT) and a grid overlay. **Capture** saves a still at screen size or 1080p, 1440p, 4K or 8K, as PNG or WebP. Photo mode can also add **camera keys** (a camera path) for the capture dialog. F10 or Esc closes it.
- **Share card:** the Cascade Report's **Share card** makes an image of your score and longest chain to send to friends.
- **Modules** export and import as `.knockmod` files (§3.6).

---

## 8. Controls reference

| Building | | Running | |
|---|---|---|---|
| Place / select | Left click | LET IT RIP / pause | Space |
| Move a part | Drag it (Shift = up / down, Alt = free, Esc cancels) · gizmo arrows / squares | | |
| Gizmo on / off · world / local axes | A · X | | |
| Box select (Select tool) | Shift + drag on empty space (Ctrl toggles) | | |
| Copy · paste · duplicate | Ctrl+C · Ctrl+V (click drops) · Ctrl+D | | |
| Mirror the selection | Alt+X / Alt+Y / Alt+Z | | |
| Place freely (no grid snap when dragging, no port snap) | Hold Alt | | |
| Hotbar | 1–0 | Stop (back to build) | Backspace |
| Previous / next part | [ / ] | Step back / forward a tick | , / . |
| Library | L | Speed | − / = |
| Command palette | Ctrl/⌘ K | Cycle cameras | C |
| Radial menu | Hold Q | Poke | Click THE BUTTON · Ctrl + click a part |
| Orbit / pan / zoom | Right drag / middle drag / wheel | Solo preview (MP) | Shift+Space |
| Focus | F | Photo mode / capture dialog | F10 / Shift+F10 |
| Select / Path / Wire | V / P (Shift+P slim) / E | **Together** | |
| Work plane height | Ctrl + wheel | Chat | / (Enter sends) |
| Rotate yaw / pitch / roll | R / T / Y (Shift = reverse) · gizmo rings | Ping | G |
| Resize (ZONE, FORCE WALL, STASIS FIELD) | Gizmo corner cubes (face handles with the gizmo off) · Shift + = / − | **Anytime** | |
| Delete · hide | Del · H | X-ray | Hold Tab |
| Group · ungroup · lock | Ctrl+G · Ctrl+Shift+G · Ctrl+L | Outliner | Ctrl+\\ |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z | Close the top panel / stop | Esc |
| Fine snap | Shift | Perf readout (frame and sim timings) | F9 |
| Keyboard building: cursor / nudge · pick up / place / connect | Arrows (Ctrl = fine) · Enter | Captions | Settings › Accessibility |
| Keyboard building: height | PageUp / PageDown | Into the panels / back to the world | Tab / Esc |
| Keyboard camera: orbit · zoom | Shift + arrows · = / − | | |

Single keys can be remapped in **Settings › Controls**.

---

## 9. Parts glossary

What each part does, in one line. Hover a card in the Library for the full *Needs / Does* and tips.

**Rollers** — **THUD** heavy ball, knocks anything over · **BOING** bouncy ball · **STITCH** small hard ball · **FUZZ** fuzzy ball that floats · **PIG IRON** iron ball, magnetic · **GLINT / BEARING** glass / steel marbles · **YOLK** egg, splats · **HELIO** balloon full of toy helium: floats (sinks on the Moon: no air), can lift an empty SCOOP, squishes, pops on sharp or hot things or a fast hit

**Frame** — **BRIK** bricks that really collapse · **PLANK** wood beam, burns · **SLOPE** ramp · **TUBE** clear tube wide enough for any ball, drawn with the Path tool (a slim one for marbles) · **VORTEX** funnel · **LEDGE** shelf · **FULCRUM** seesaw (tips 12° each way) · **SPRONG** trampoline · **TRAP BOX** drops when its line is released and traps any critter, even Biscuit or Dusty · **SCOOP** bucket, gets heavy when filled · **ANCHOR** tie point · **SHEAVE** pulley · **FLAP** door or trapdoor · **BOOSTER** kicks marbles along a GLIDEPATH · **SPINDECK** turntable · **LIFT** elevator

**Drive** — **TREADWAY** conveyor · **BAND** drive belt (Wire tool between spin ports) · **LINE** rope (Wire tool between tension ports) · **COG** gear, incl. bevel; its teeth pop HELIOs · **RACK** rack and pinion · **MOTOR** electric motor · **DYNAMO** turns spin into power (it takes effort: it brakes whatever drives it) · **HAMSTER DRIVE** bump it and Pip wakes up and sprints the wheel for 6 s · **TURBINE** wind turns it: a GALE's, or the weather's (Settings › World › Weather) blowing on its front (from behind it spins backwards, straight across not at all) · **PEDAL RIG** Bandit pedals when lured or startled · **RAM** piston · **GRABBER** robot arm: with power, each signal on its **go** port sends it to pick up what's at zone A and put it down at zone B (§3.7); its fingers close on what it carries; up to 1 kg, and it must fit its grip width; nothing at A and it shrugs; *Repeat while powered* keeps it going; a weak power supply slows it

**Air** — **GALE** fan · **PUFFER** bellows, squash it to puff · **BLOWOUT** hair dryer (air + heat) · **VAC** suction · **INFLATOR** helium tank, fills a HELIO (too much = pop)

**Power and Signal** — **MAINS** power with a toggle · **CELL** battery · **SUNCELL** light → power · **LAMP** bulb · **TORCH** flashlight · **BURNING GLASS** focuses light into heat · **LANCE** laser · **MIRROR / SPLITTER** bounce / split beams · **TRIPWIRE** beam sensor · **STOMP PAD** pressure plate · **THE BUTTON** big red button · **TOGGLE** lever switch · **RINGER** alarm-clock timer (1–30 s) · **DELAY** holds a signal for a while · **PING** wireless pair · **MAGLOCK** electromagnet, grabs steel (hang it from a LINE for a crane) · **ARC TOWER** Tesla coil, arcs to metal

**Fire and Boom** — **WICK** candle · **FUSE** burns along its route (Wire tool between heat ports) · **BANGSTICK** dynamite · **T-PLUNGER** detonator, wires up to 64 explosives · **POWDER KEG** big boom, also cooks off if it sits in heat · **JITTERJUICE** nitro, goes off at the lightest knock · **SKYROCKET** rocket · **SKYSHOW** fireworks · **BIG TOP** circus cannon: its iris bore closes around any ball you load (even a handful of marbles) · **CORK BLASTER** pop-gun, its cork pops HELIOs · **FLAMER** blowtorch, switched by a signal · **POPPER** confetti and a puff of air (not an explosive) · **SINGULARITY** tiny black hole: a signal opens it for 6 s and it swallows everything within 20 m (critters get spat back out; up to 4 per world, and the editor won't place a fifth; finale only, please)

**Contraptions** — **PUNCHLINE** spring boxing glove · **GOTCHA BOX** pop-up clown box · **SNIPPER** scissors, cuts lines and belts · **SNAPTRAP** mousetrap, flings things · **BONKER** mallet · **FLINGER** catapult · **WRECKER** wrecking ball · **PINGER** spring plunger · **PADDLE / BUMPER** pinball flipper / bumper · **TOAST CANNON** toaster · **FISHBOWL** Goby's bowl, shatters and splashes

**Matter** (§4½) — **GRIT HOPPER** sand; a Signal opens or closes the gate · **HOURGLASS** sand timer, signals when empty · **TANK** 15 L of water with a valve · **SPRINKLE CAN** tip it to pour · **WATERWHEEL** water or sand in its buckets turns it (Spin out) · **SPONGE** soaks up water and gets heavy; squeeze it to wring it out · **MARBLE HOPPER** up to 100,000 marbles · **GOO VAT** 9 L of sticky goo with a valve; the lid hatch soaks goo back up

**Fun** — **TOPPLE TILES** dominoes · **PINS** bowling pins · **STACKERS** block tower · **PANE / VASE** glass · **TONEBARS** xylophone, plays in key · **DING** bell · **ZIPPY** RC buggy: drives on a Signal (or from the start), stops, reverses or ignores a bump, and can tow a line · **QUACK** rubber duck: floats, squeaks when squeezed

**Future Tech** — **FABRICATOR** spits out parts · **RECYCLER** swallows parts and counts them · **ZONE** a gravity, antigrav, wind or stasis volume (resize it with its handles) · **RIFT GATES** paired portals: anything that fits the ring (any ball, up to about 30 cm across) rolled into one gate's front shoots out of its twin's front with the same speed; one trip per pair every 0.25 s, the rest bounce; the back is solid; pair them by colour (§3.7) · **GRAV WELL** with power, pulls everything within 5 m toward its orb (or pushes it away) · **TRACTOR BEAM** with power, reels things in along its beam or holds them floating 0.5–3 m out (up to 2 kg); it can't reach anything hidden behind something else in its beam · **HOVER PAD** with power, rises 0.5 m and hovers there with up to 10 kg on it; drops when the power stops · **FORCE WALL** a solid energy wall while on; each signal switches it on or off (set whether it starts on; resize it 0.1–1 m) · **COILGUN RING** with power, gives steel balls passing through a +3 m/s kick, then recharges for 0.5 s · **STASIS FIELD** with enough power, freezes everything inside it in mid-air until the power stops (resize it 0.1–1 m each way) · **BUZZ BEACON** BUZZ's landing pad: a signal sends BUZZ to fetch the nearest tagged object and drop it here

**Critters** — **MOCHI** the cat (chases Pip, scared of loud noises and Biscuit) · **PIP** the hamster (loves seeds, naps in wheels until bumped) · **GOBY** the goldfish (flops for a bit if the bowl breaks, then a bubble carries him to safety) · **BANDIT** the raccoon (pedals, steals shiny things) · **BISCUIT** the dog (12 kg: sleeps until a loud noise, then chases Mochi, barging through things and barking every 1.5 s, and each bark is a Sound that can wake or startle others) · **HENNY** the chicken (startle her and she flaps up and lays a **YOLK**, a fragile egg that splats) · **DUSTY** the robot vacuum (patrols the zone you draw, bumps and turns at its edge, beelines for spilled sand and marbles and sucks them up, getting heavier until its bin is full) · **BUZZ** the courier drone (docks on the BUZZ BEACON of its colour; when the beacon gets a signal it flies to the nearest **tagged** object up to 2 kg, winches it up and drops it on the beacon's pad; a heavy load makes it fly lower and climb slower; a big boom nearby makes it jump for a moment, but it holds on to its load; hit it hard and it tumbles, rights itself and finishes the job). Critters never get hurt, just dizzy. With captions on, you can read what they're saying.

---

## 10. Starter recipes

1. **The Classic:** THUD rolls down a SLOPE onto one end of a FULCRUM. The other end flips a BOING up into a COG train turned by a MOTOR, and the turning teeth pop a HELIO.
2. **Power Chain:** Ball lands on a STOMP PAD → signal to MAINS (toggle on) → power to a GALE → wind spins a TURBINE → BAND to a TREADWAY that carries a FUZZ to the edge.
3. **Light the Way:** A ball hits THE BUTTON → signal switches on a TORCH → beam → MIRROR → BURNING GLASS focused on a FUSE → FUSE burns along a shelf into three BANGSTICKs.
4. **Hamster Power:** A swinging WRECKER bumps a HAMSTER DRIVE → Pip sprints for 6 s → BAND → TREADWAY carries a STITCH off its end onto THE BUTTON → signal opens a FLAP → the marbles piled on it pour out. (A hamster makes spin, not much power: a DYNAMO on a hamster wheel won't light a LAMP.)
5. **Critter Chaos:** RINGER goes off at 5 s → BISCUIT wakes and chases MOCHI → Mochi bolts across a STOMP PAD → PUNCHLINE punches a JITTERJUICE, which goes off at the lightest knock. 💥
6. **Portal Drop:** Lay a RIFT GATE face up on the floor and stand its twin (the next one you place pairs with it) facing a row of TOPPLE TILES. Drop a STITCH into the lying gate: it shoots out of the standing one into the tiles.
7. **Special Delivery:** Put a BUZZ BEACON and a BUZZ on it (same colour). Tag a light part across the room (Inspector › Tagged for BUZZ). Wire a STOMP PAD to the beacon's **call** port and roll a THUD onto the pad: BUZZ flies off, fetches the tagged part and drops it on the beacon. Put a STOMP PAD under the beacon's pad to keep the chain going.
8. **Moon Shot:** In a Room world, switch to **Moon Base** (Settings › World). Fire a CORK BLASTER or a FLINGER and watch how far things go at 16.5 % gravity, and see what happens to a HELIO with no air.
9. **Co-op Relay:** each player builds half. Player 1's chain must end by dropping a ball into a TUBE that crosses into Player 2's half. Agree on the hand-off point with a ping (G) first.

---

## 11. Settings and comfort

- **Graphics:** quality tier (auto-detected; applies when you reload), render scale, **depth of field** while building and running (a gentle background blur; on by default, off with reduced motion), and the Studio's dark backdrop.
- **Performance:** **Physics threads**: how many of your CPU's cores the physics uses. *Auto* uses all but 3 (2–12); *Off* is single-threaded. More threads keep big machines (thousands of parts, huge blasts) in real time. It applies when you reload, and **machines play out exactly the same at any setting**, so you and your partner can choose differently. The tab says how many threads this session is using (the F9 readout too).
- **Comfort:** *Reduce flashing* (on by default), camera shake, hitstop, auto slow-mo, how often the director cuts, reduced motion.
- **Accessibility:**
  - **Reduce transparency:** solid panels instead of frosted glass (automatic on 4 GB GPUs, and if the panels ever cost too much frame time).
  - **Colour preset:** Default, **Deuteranopia**, **Protanopia** (both red–green), **Tritanopia** (blue–yellow) or **High contrast**. Each swaps the channel colours for a palette tested to stay distinct for that kind of colour vision, and changes the player and warning colours where they clash; High contrast also darkens the panels and strengthens edges and focus rings. Every channel keeps its own glyph shape in every preset, and pair colours are always named.
  - **UI scale** 75–200 %: the panels grow, and the layout switches to its compact arrangement when it needs the room (200 % fits a 1440 × 900 window or bigger).
  - **Captions:** event captions and critter emote text (§5).
  - **Keyboard building aids:** the keyboard cursor, Enter to place / pick up / connect, port and part cycling, and the tap-to-open radial (§3.8).
  - **Port glyphs:** channel glyphs on ports in the 3D view (§4).
  - Every control works from the keyboard with a visible focus ring and has a screen-reader label; toasts, chat, captions, tool changes and run starts and stops are announced. Text meets WCAG 2.2 AA contrast (4.5:1) on glass, on solid panels and in every preset.
- **Controls:** remap single keys; conflicts are highlighted.
- **Audio:** master, music and effects volumes, mute.
- **Multiplayer:** nickname, ping sounds.
- **World** (shared with your partner): the environment (§2½), **Zero-g zones** (Orbital Hangar), **Weather** (wind, §2½), **Sand, water and marbles** (the Matter switch, §4½), **Fill the sink** (Mega Kitchen).
- **About:** build, protocol and physics info, and **Export diagnostics** for bug reports.

---

## 12. If something goes wrong

| What you see | What to do |
|---|---|
| "WebGPU not available" | Use the `https://` address, update your browser, and see `/check` |
| Game very slow, `/check` says not cross-origin isolated | Disable privacy extensions for the local site and reload. (Physics also runs single-threaded then: Settings › Performance says so) |
| "Needs 16 GB tier" | That world is too big for your (or your partner's) GPU tier |
| "SIM 0.4×" | Your machine is huge; use Bake & Watch, or check Settings › Performance › Physics threads isn't Off |
| The world card's Matter meter is red, "needs 16 GB" | Your containers hold more sand, water or marbles than this tier allows: lower their *Capacity* or *Full at start*, turn the Matter switch off (Settings › World), or play on a bigger GPU |
| A RIFT GATE does nothing | It has no twin: the Inspector says "No twin yet". Place another gate of its colour, or pick a colour that has one gate |
| BUZZ doesn't take off | Its beacon needs a signal on its **call** port; BUZZ needs a beacon of its colour, and a **tagged** object of 2 kg or less (the Inspector warns when a tagged part is too heavy) |
| A GRABBER grabs nothing | Point its zone A at the object (Inspector › Zones A and B); it needs power *and* a signal on **go**, and carries up to 1 kg that fits its **Grip width** (a STITCH needs about 8 cm) |
| A TRACTOR BEAM ignores something in its beam | Something else is in the way: it only reaches things it can "see" from its lens. Or it's carrying its 2 kg already |
| The Orbital Hangar isn't in the environment list | It needs a Warehouse or Arena world (the list says which sizes fit) |
| "Switched to solid panels to keep the frame rate" | The frosted glass was costing too much GPU time, so the panels went solid until the next launch. Nothing else changes |
| "The host updated the game. Reload" | Reload the page |
| "Re-synced at 12.4 s" | The game fixed a mismatch automatically; the host keeps a report for the developers |

More: [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md).

---

## 13. Not in the beta yet

These are designed ([GAME_SPEC.md](../GAME_SPEC.md)) but not built yet, so no key does them today:
- The **Brush** tool (laying TOPPLE TILES, BRIK walls, PINS in a stroke: place them one by one for now), the **Measure** tool, and drawing GUTTERs and GLIDEPATHs yourself (they appear in the Library's demo machines).
- **Wall and Surface work planes** (W / Shift+W), the surface-snap toggle (N), and click-drag to rotate while placing.
- Isolate (I) and **Test-run selection** (Ctrl+Enter). (Box select, copy / paste / duplicate, mirroring and port snapping are in: §3.1, §3.3.)
- The **History** panel (restore an older version), exporting and importing whole worlds as `.knockon` files, and skins.
- The Graphics settings *Budget override*, *Particle cap* and *Unlimited Mayhem*.
- The **Fly** camera, front / side / top views (numpad), the Overview map key (O), and jumping to or following your partner's view (F2 / F3); the partner's laser, off-screen arrow, held-part outline and ping radial.
