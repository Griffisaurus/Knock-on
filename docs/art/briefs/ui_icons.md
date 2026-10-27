# UI icon and brand briefs

The full UI icon set, the 12 channel glyphs, the KNOCK-ON brand mark, cursors, the Library card thumbnail rig, loading and empty-state illustrations, and the multiplayer player drone.

Back to the [brief index](./README.md) · Rules: [ART_BIBLE §12](../ART_BIBLE.md#12-ui-art) · Design system: [GAME_SPEC §9](../../../GAME_SPEC.md) · Multiplayer: [MULTIPLAYER §6, §8.1](../../MULTIPLAYER.md) · Controls: [HOW_TO_PLAY §8](../../HOW_TO_PLAY.md)

| Asset | Class | Count | Ship | Stage |
|---|---|---|---|---|
| UI line icons (`ic_*`) | UI | 255 IDs (248 drawings) | M1 for M1 features · the rest ship with their features (M2–M5) | brief |
| Channel glyphs (filled) | UI | 12 | M1 | brief |
| Critter emote glyphs | UI | 24 | M2 | brief |
| Brand mark (wordmark, app mark, 3D logo) | Brand | 1 family | M1 | brief |
| Cursor set | UI | 36 | M1 | brief |
| Library card thumbnail rig | Tool | — | M1 | brief |
| Loading and empty-state illustrations | UI | 3 loaders + 13 empty states | M1–M4 | brief |
| `mp_drone`: player drone avatar + name tag, laser, pings | In-world UI, S | 1 | M1 | brief |

---

## 1. Icon system

| Spec | Value |
|---|---|
| Master grid | **24 × 24 px**, 2 px padding → 20 × 20 live area |
| Keylines | Circle Ø 20 · square 18 × 18 · portrait 16 × 20 · landscape 20 × 16 |
| Stroke | **1.75 px** at 24 px, centred, **rounded caps and joins** (ART_BIBLE §12, GAME_SPEC §9.4) |
| Corners | 2 px radius on rectangles (1 px minimum on small inner corners) |
| Spacing | ≥ 2 px between parallel strokes · interior counters ≥ 3 px |
| Angles | 0°, 45°, 90° preferred; 30° / 60° allowed for arrows and perspective cubes |
| Perspective | Flat front views by default. 3D objects (cube, plane) use a fixed 30° isometric |
| Fill | Line icons are **unfilled**. Exceptions: channel glyphs (§3), emote glyphs (§2.12), status dots, player and ping markers, and the four `-fill` variants used for "on" states (`ic_favourite-fill`, `ic_lock-fill`, `ic_pin-fill`, `ic_bookmark-fill`; hidden uses the separate `ic_eye_off` drawing) |
| Text in icons | None, except axis letters X / Y / Z and tier numerals, drawn as strokes, not font glyphs |

**Sizes**

| Size | Stroke | Drawing | Used in |
|---|---|---|---|
| 16 px | 1.5 px | **Hand-simplified** variant (`@16`) for dense lists | Outliner rows, chips, toasts |
| 20 px | 1.5 px | Scaled from 24 with the stroke re-set | Inspector rows, menus |
| **24 px** | **1.75 px** | **Master** | Top bar, dock, toolbars |
| 32 px | 2.0 px | Scaled from 24 | Run-bar transport, radial menu |
| 48 px | 2.5 px | Scaled from 24, details may be added | Small empty states, lobby tiles |

**Colour states** (single colour, `currentColor`)

| State | Colour |
|---|---|
| Default | Paper `#EEF1F6` on dark |
| Secondary | Fog `#8A93A6` |
| Disabled | Fog at 40 % |
| Selected / active / focus | Beam `#2FD6FF` |
| On an Ignition primary button | Void `#0B0D12` (dark on Ignition, 6.3 : 1) |
| Positive / powered | Volt `#C6FF3A` |
| Warning | Amber `#FFB020` |
| Error / invalid / destructive hover | Danger `#FF4D5E` |
| Player-owned (MP) | Player colour (§8) |

**Files and export**
- Source: `assets/src/ui/icons/<id>.svg` (24 viewBox), `<id>@16.svg` where a 16 px variant exists.
- SVG rules: paths only (no transforms, masks, filters or text), coordinates rounded to 0.25 px, `stroke="currentColor"`, `stroke-width="1.75"`, `stroke-linecap="round"`, `stroke-linejoin="round"`, `fill="none"` (filled icons use `fill="currentColor"`, no stroke). Strokes stay strokes so the UI can re-weight them.
- Build: the UI imports them as Solid components. The engine gets an **MSDF atlas** (2048², 64 px cells) of the same icons for in-world labels, `SCREEN` icons (shared_kit.md §5) and billboards.
- Naming: `ic_<group>_<name>`; variants `-fill`, `@16`.
- Motion: icon animations follow GAME_SPEC §9.4 (120–200 ms ease-out) and are removed by Reduced motion.

---

## 2. Icon list

Shape descriptions are for the 24 px master. Keys in brackets are default bindings (HOW_TO_PLAY §8).

### 2.1 App and top bar (14)

| ID | Meaning | Shape |
|---|---|---|
| `ic_app_menu` | Main menu [Esc] | Three horizontal lines, middle one shorter |
| `ic_app_mark` | App mark in the top bar | The brand app mark (§4.4), filled |
| `ic_save_saved` | Saved | Rounded floppy outline with a check |
| `ic_save_saving` | Saving | Floppy with a 270° arc (animated rotation) |
| `ic_save_unsaved` | Unsaved changes | Floppy with a filled dot at top right |
| `ic_undo` / `ic_redo` | Undo / redo [Ctrl+Z / Ctrl+Shift+Z] | Hook arrow curving left / right |
| `ic_share` | Share link (⧉) | Two overlapping rounded squares, the front one with an up-right arrow |
| `ic_palette` | Command palette [Ctrl/⌘ K] | Rounded square containing a chevron ">" and an underscore |
| `ic_settings` | Settings | 8-tooth cog with a round hole |
| `ic_help` | Help / manual | Circle with a question mark |
| `ic_fullscreen` / `ic_fullscreen_exit` | Fullscreen | Four outward / inward corner brackets |
| `ic_close` | Close | X, 14 px arms |

### 2.2 Modes, world and environment (27)

| ID | Meaning | Shape |
|---|---|---|
| `ic_mode_build` | BUILD mode | Isometric cube sitting on a 3-line grid |
| `ic_mode_run` | RUN mode | Play triangle with two speed lines behind |
| `ic_env_studio` | THE STUDIO | Cyclorama sweep curve with a small softbox rectangle above |
| `ic_env_kitchen` | MEGA KITCHEN | Kettle with spout and handle |
| `ic_env_backlot` | BACKLOT | Water tower: round tank on four legs |
| `ic_env_hangar` | ORBITAL HANGAR | Wide window frame with a planet arc in the lower half |
| `ic_env_moon` | MOON BASE | Crescent with two crater circles |
| `ic_grav_earth` | Gravity Earth | Circle with a down arrow beneath |
| `ic_grav_moon` | Gravity Moon 16.5 % | Crescent with a short down arrow |
| `ic_grav_mars` | Gravity Mars 38 % | Circle with two horizontal bands and a medium down arrow |
| `ic_grav_zero` | Zero-G | Down arrow crossed by a horizontal bar, with a floating dot above |
| `ic_grav_heavy` | Heavy 200 % | Trapezoid weight with a double down arrow |
| `ic_air` | Air density | Three wavy lines beside a small gauge arc |
| `ic_feel_real` / `ic_feel_floaty` / `ic_feel_snappy` | Feel presets | Ball with a normal arc / a long high arc / a sharp zig-zag bounce |
| `ic_preset_desk` | Desk world | Small desk with a lamp |
| `ic_preset_room` | Room world | Isometric open box (three walls) |
| `ic_preset_warehouse` | Warehouse world | Building with a sawtooth roof |
| `ic_preset_arena` | Arena world | Stadium oval with tiers |
| `ic_preset_mega` | Megastructure world | Three nested isometric squares |
| `ic_tod` | Time of day (Backlot) | Circle split: sun rays on the left half, crescent on the right |
| `ic_weather` | Weather / wind | Two wind lines with a curl |
| `ic_cyc_toggle` | Studio Light / Dark cyc | Circle half filled |
| `ic_sink_fill` | Kitchen "Fill the sink" | Tap with a drop |
| `ic_zone_zerog` | Hangar zero-g zones | Floor ellipse with an upward floating dot |
| `ic_base_lights` | Moon "Base lights" | Floodlight head with three rays |

### 2.3 Tools and work planes (29)

| ID | Meaning | Shape |
|---|---|---|
| `ic_tool_place` | Place | Arrow cursor with a plus at lower right |
| `ic_tool_select` | Select / Move [V] | Arrow cursor |
| `ic_tool_move` | Move gizmo | Four-way arrow cross |
| `ic_tool_rotate` | Rotate gizmo | 300° circular arrow around a dot |
| `ic_tool_resize` | Resize [+ / −] | Rounded square with diagonal outward arrows at two corners |
| `ic_tool_path` | Path [P] | Pen nib drawing an S-spline with two control dots |
| `ic_tool_brush` | Brush [B] | Three dominoes leaning along a curve |
| `ic_tool_wire` | Wire [E] | Two-prong plug with a curved cable |
| `ic_tool_measure` | Measure [M] | Diagonal ruler with 4 ticks |
| `ic_terrain_raise` / `_lower` / `_flatten` / `_smooth` | Terrain brushes (Backlot) | Mound + up arrow / dip + down arrow / flat line between two inward brackets / jagged line morphing into a smooth wave |
| `ic_plane_floor` | Floor plane | Isometric flat grid parallelogram |
| `ic_plane_wall` | Wall plane [W] | Upright rectangle with a grid |
| `ic_plane_surface` | Surface plane [Shift+W] | Tilted plane with a normal arrow |
| `ic_plane_up` / `ic_plane_down` | Plane height [Ctrl+wheel] | Floor plane with an up / down arrow |
| `ic_snap_port` | Port snap | Port ring (circle in circle) with two magnet arcs |
| `ic_snap_surface` | Surface snap [N] | Small cube resting on a tilted line |
| `ic_snap_grid` | Grid snap | 3 × 3 grid with a magnet |
| `ic_snap_fine` | Fine snap [Shift] | Dense 4 × 4 grid |
| `ic_snap_free` | No snap [Alt] | 3 × 3 grid with a diagonal slash |
| `ic_rot_yaw` / `_pitch` / `_roll` | Rotate [R / T / Y; Shift+R / T / Y = reverse] | Flat horizontal ellipse arrow / vertical ellipse arrow / circle arrow around a forward dot |
| `ic_mirror_x` / `_y` / `_z` | Mirror [Alt+X/Y/Z] | Two triangles mirrored over a dashed axis, axis letter drawn at the end |

### 2.4 Edit and organise (32)

| ID | Meaning | Shape |
|---|---|---|
| `ic_duplicate` | Duplicate [Ctrl+D] | Two offset rounded squares with a plus |
| `ic_copy` / `ic_paste` | Copy / paste | Two offset rounded squares / clipboard |
| `ic_delete` | Delete [Del] | Bin with a lid and two inner lines |
| `ic_group` / `ic_ungroup` | Group [Ctrl+G] | Dashed rounded box around two squares / same with the box broken |
| `ic_lock` / `ic_lock-fill` / `ic_unlock` | Lock [Ctrl+L] | Padlock closed / filled / shackle open |
| `ic_layers` | Layers | Three stacked isometric diamonds |
| `ic_eye` / `ic_eye_off` | Visible / hidden | Eye / eye with a slash |
| `ic_outliner` | Outliner | Tree list: three rows with indent connectors |
| `ic_library` | Library ▦ [L] | 2 × 2 grid of rounded squares |
| `ic_slot_empty` | Empty hotbar slot | Dashed rounded square |
| `ic_module` | Module | Crate with a small cog on its face |
| `ic_module_save` | Save as Module | Crate with a down arrow into it |
| `ic_bookmark` / `-fill` | Camera bookmark | Ribbon bookmark |
| `ic_note` | Sticky note | Square with a folded corner and two lines |
| `ic_search` | Search | Magnifier |
| `ic_filter` | Filter | Funnel |
| `ic_favourite` / `-fill` | Favourite | 5-point star |
| `ic_recent` | Recent | Clock face with an anticlockwise arrow around it |
| `ic_inspector` | Inspector | Three horizontal sliders with knobs |
| `ic_test_selection` | Test-run selection [Ctrl+Enter] | Dashed selection box with a small play triangle inside |
| `ic_clear_world` | Clear world (the Bomb) | Round bomb with a curled fuse and a 3-ray spark; hover turns Danger |
| `ic_radial` | Radial menu [hold Q] | Circle divided into 4 wedges with a centre dot |
| `ic_connect` | Connect (radial) | Two port rings linked by a curve |
| `ic_isolate` | Isolate [I] | Target ring around a cube |
| `ic_skin` | Skin / variant | Paint swatch fan (three rounded rectangles) |

### 2.5 Seeing inside (8)

| ID | Meaning | Shape |
|---|---|---|
| `ic_xray` | X-ray overlay [hold Tab] | Isometric cube with dashed hidden edges and a flow arrow through it |
| `ic_section_box` | Section box | Cube with a slicing plane through it |
| `ic_cutaway` | Auto-cutaway | Cube with a dithered bite out of the front corner |
| `ic_ghost_trails` | Ghost trails | Ball with a dotted arc trail behind it |
| `ic_grid_overlay` | Build grid overlay | Floor grid with one beam line highlighted (bold) |
| `ic_channel_filter` | Channel filter | Three small circles in a row, one filled |
| `ic_labels` | Part labels | Tag shape with a hole |
| `ic_heatmap` | Event heat (Overview) | Map rectangle with concentric rings on one spot |

### 2.6 Transport and run (24)

| ID | Meaning | Shape |
|---|---|---|
| `ic_let_it_rip` | **LET IT RIP** [Space] | Filled play triangle whose tip emits the brand spark streak (§4.2), drawn Void on the Ignition button; the streak animates on hover |
| `ic_play` / `ic_pause` / `ic_stop` | Play / pause / Stop [Backspace] | Triangle / two bars / rounded square |
| `ic_step` / `ic_step10` | Step 1 / 10 ticks [. / Shift+.] | Triangle + bar / double triangle + bar |
| `ic_step_back` | Step back [,] | Bar + left triangle |
| `ic_rewind` | Scrub / rewind | Double left triangle |
| `ic_speed_down` / `ic_speed_up` | Speed [− / =] | Single chevron left with one speed line / double chevron right with two speed lines |
| `ic_speed` | Speed menu | Gauge arc with a needle |
| `ic_marker` | Timeline event marker | Diamond on a short stem (coloured by channel) |
| `ic_bake_watch` | Bake & Watch | Three stacked film frames with a small clock |
| `ic_dilation` | Time dilation (SIM 0.42×) | Hourglass tilted 15° (shown in the Amber badge) |
| `ic_ko` | K.O. Count | Two chain links with an impact burst at the joint |
| `ic_solo_preview` | Solo preview [Shift+Space] | Play triangle inside a dashed circle with one person dot |
| `ic_poke` | Poke mode [Ctrl+drag] | Index finger tapping with two ripple arcs |
| `ic_record` | Record clip ⏺ | Filled circle inside a ring (Ignition when active) |
| `ic_photo` | Photo mode [F10] | Camera body with lens circle |
| `ic_slowmo` | Auto slow-mo | Clock face with a long sweeping arc arrow |
| `ic_countdown` | Shared countdown | Circle in 3 segments, one lit |
| `ic_hitstop` | Hitstop (comfort) | Impact burst with a pause bar |
| `ic_camera_menu` | Camera menu 🎥 | Movie camera with two reels |
| `ic_cascade_open` | Open Cascade Report | Node graph: three nodes and branching links |

### 2.7 Cameras (14)

| ID | Meaning | Shape |
|---|---|---|
| `ic_cam_orbit` | Orbit | Tilted ellipse orbit path around a dot with an arrowhead |
| `ic_cam_fly` | Fly [RMB + WASD] | Four-way arrows with the forward one doubled |
| `ic_cam_focus` | Focus selection [F] | Four corner brackets around a dot |
| `ic_cam_front` / `_side` / `_top` | Ortho views [Num 1/3/7] | Isometric cube with the front / side / top face filled |
| `ic_cam_director` | Director | Clapperboard |
| `ic_cam_ride` | Ride-cam | Ball with a small camera eye on top |
| `ic_cam_drone` | Drone cam | Quadcopter outline seen from above |
| `ic_cam_overview` | Overview map [O] | Folded map with a pin |
| `ic_cam_pip` | Picture-in-picture | Rectangle with a smaller filled rectangle at lower right |
| `ic_cam_follow` | Follow partner [F3] | Eye with a chain link |
| `ic_cam_jump` | Jump to partner [F2] | Eye with a right arrow |
| `ic_cam_path` | Recorded drone path | Dotted spline with keyframe diamonds |

### 2.8 Part families (11) and Library tabs (3)
Line icons, distinct from the filled channel glyphs.

| ID | Family | Shape |
|---|---|---|
| `ic_fam_rollers` | Rollers | Ball with a motion arc |
| `ic_fam_frame` | Frame | I-beam in perspective |
| `ic_fam_drive` | Drive | Cog with 10 teeth meshing a small cog |
| `ic_fam_air` | Air | Three-blade fan in a ring |
| `ic_fam_power` | Power & Signal | Two-prong plug |
| `ic_fam_boom` | Fire & Boom | Stick with a curled fuse and spark |
| `ic_fam_contraptions` | Contraptions | Coil spring with a pad on top |
| `ic_fam_matter` | Matter | Hopper funnel with three grains falling onto a pile |
| `ic_fam_fun` | Fun & Sound | Two dominoes, one toppling |
| `ic_fam_future` | Future Tech | Portal ring with a 4-point sparkle |
| `ic_fam_critters` | Critters | Paw print |
| `ic_tab_modules` / `ic_tab_favourites` / `ic_tab_recent` | Library tabs | = `ic_module` / `ic_favourite` / `ic_recent` |

### 2.9 Status (27)

| ID | Meaning | Shape |
|---|---|---|
| `ic_st_powered` / `ic_st_unpowered` | Powered / not | Bolt in a circle / bolt with a slash |
| `ic_st_fault` | Jam / fault | Cog with an exclamation mark (Amber) |
| `ic_st_stall` | Motor stall | Cog with a pause bar |
| `ic_st_overload` | Overload | Bolt with an exclamation mark |
| `ic_st_warning` | Warning | Rounded triangle with ! |
| `ic_st_error` | Error | Circle with an X (Danger) |
| `ic_st_info` | Info | Circle with an i |
| `ic_st_success` | Success | Circle with a check (Volt) |
| `ic_st_asleep` | Body asleep | Crescent with a small z |
| `ic_st_moving` | Body awake | Ball with three motion lines |
| `ic_st_port_on` / `ic_st_port_off` | Port connected / free | Port ring filled centre / empty |
| `ic_st_locked_partner` | Locked by partner | Padlock with a dot (dot in the partner's colour) |
| `ic_st_autosave` | Autosaving | Floppy with a circular arrow |
| `ic_st_offline` | Host unreachable | Unplugged plug and socket apart |
| `ic_st_sync` | Syncing | Two arrows chasing in a circle |
| `ic_st_resynced` | Re-synced | Circle arrow ending in a check |
| `ic_st_waiting` | Waiting on partner | Hourglass with a person dot |
| `ic_st_tier4` / `_tier8` / `_tier12` / `_tier16` | GPU tier badge | Chip outline (square with pins) containing the stroked numeral |
| `ic_st_gpu` | GPU | Chip outline with a fan circle |
| `ic_st_memory` | Memory budget | RAM stick with 4 chips |
| `ic_st_device_lost` | Device lost | Chip with a jagged crack |
| `ic_st_no_webgpu` | WebGPU unavailable | Chip with a slash |

### 2.10 Multiplayer (19)

| ID | Meaning | Shape |
|---|---|---|
| `ic_ping` | Ping [G] | Map pin with one ripple arc |
| `ic_ping_look` | Ping: Look here | Pin containing an eye |
| `ic_ping_help` | Ping: Help | Pin containing a lifebuoy ring |
| `ic_ping_nice` | Ping: Nice! | Pin containing a 4-point sparkle |
| `ic_ping_boom` | Ping: Boom incoming! | Pin containing a bomb with "!" spark |
| `ic_ping_radial` | Ping radial [hold G] | Circle in 4 wedges with the 4 mini ping glyphs |
| `ic_player` | Player marker | Drone glyph (round camera ball with a lens dot + 4 rotor rings), **filled**, in the player colour |
| `ic_player_offscreen` | Partner off-screen | Chevron pointing out with a small drone dot |
| `ic_chat` | Chat [/] | Rounded speech bubble with a tail |
| `ic_chat_send` | Send | Paper plane |
| `ic_host` | Host player | Three-point crown |
| `ic_guest` | Guest | Person (head + shoulders) |
| `ic_players` | Players online | Two overlapping persons |
| `ic_kick` | Kick (host only) | Person with an X |
| `ic_invite` | Copy host link | Chain link with a plus |
| `ic_session_tier` | Session tier | Chip with two person dots |
| `ic_lobby` | Lobby | Door with a person dot |
| `ic_world_switch` | Switch world (host) | Globe with a circular arrow |
| `ic_build_mismatch` | Build mismatch | Two boxes with a "≠" between |

### 2.11 Cascade Report, save and capture (15)

| ID | Meaning | Shape |
|---|---|---|
| `ic_rep_chain` | Longest chain | Three chain links with an arrow |
| `ic_rep_score` | Overreaction Score | Gauge with the needle in the top zone |
| `ic_rep_boom` | Biggest boom | Burst star with a ring |
| `ic_rep_parts` | Parts used | Three stacked cubes |
| `ic_rep_channels` | Channels used | Three circles in a triangle |
| `ic_rep_peak` | Peak simultaneous events | Line graph with one tall spike |
| `ic_rep_card` | Share report card | Card with an up arrow |
| `ic_world_new` | New world | Rounded square with a plus |
| `ic_world_open` | Open world | Folder |
| `ic_save_as` | Save as | Floppy with a plus |
| `ic_export` / `ic_import` | Export / import `.knockon` | Box with an arrow out / in |
| `ic_history` | Version history | Clock with an anticlockwise arrow and a dot trail |
| `ic_clip` | Clip export | Film strip |
| `ic_link` | Link | Two chain links |

### 2.12 Critter emote glyphs (24)
**Filled**, two colours allowed (Graphite `#12151C` outline 2 px at 24 + one brand accent). Drawn at 24 px and exported at 256 px into the `fx_critter` atlas for in-world emote bubbles ([vfx.md §5](vfx.md#5-critter-comedy)). They replace system emoji everywhere.

| # | ID | Meaning | Shape and accent |
|---|---|---|---|
| 1 | `em_eyes` | Spotted something ("👀") | Two ovals with pupils glancing right, Beam pupils |
| 2 | `em_grumpy` | Annoyed cat ("😾") | Cat face with furrowed brows, Ignition brows |
| 3 | `em_happy` | Happy | Round face with closed smiling eyes, Volt cheeks |
| 4 | `em_love` | Loves it | Heart, Plasma |
| 5 | `em_fish` | Wants Goby | Small fish silhouette, Amber |
| 6 | `em_seed` | Wants seeds | Sunflower seed, Bone with Graphite stripes |
| 7 | `em_snack` | Wants a snack | Cookie with chips, Amber |
| 8 | `em_shiny` | Wants shiny | Faceted gem with sparkle, Beam |
| 9 | `em_bone` | Wants a bone | Dog bone, Bone |
| 10 | `em_note` | Heard a sound | Eighth note, Plasma |
| 11 | `em_question` | Confused | "?", Amber |
| 12 | `em_alert` | Startled | "!", Ignition |
| 13 | `em_sleep` | Sleepy | Two stacked Z's, Bone |
| 14 | `em_sweat` | Nervous | Sweat drop, Beam |
| 15 | `em_dizzy` | Dizzy | Spiral, Amber |
| 16 | `em_celebrate` | Celebrating | Party burst with 3 sparkles, Volt |
| 17 | `em_bubble` | Goby safe | Bubble with a highlight, Beam |
| 18 | `em_egg` | Henny laid an egg | Egg, Bone |
| 19 | `em_dust` | Dusty full of dust | Dust bin with grains, Graphite + Amber |
| 20 | `em_parcel` | Buzz carrying | Parcel with string, Bone |
| 21 | `em_bell` | Alarm heard | Ringing bell, Amber |
| 22 | `em_paw` | Following a scent | Paw print, Graphite |
| 23 | `em_run` | Fleeing | Three speed dashes and a dust puff, Bone |
| 24 | `em_sniff` | Sniffing | Nose with two scent curls, Volt |

### 2.13 Settings, comfort and generic controls (32)

| ID | Meaning | Shape |
|---|---|---|
| `ic_volume` / `ic_mute` / `ic_music` / `ic_sfx` | Audio | Speaker with waves / with X / two beamed notes / speaker with a burst |
| `ic_keyboard` / `ic_mouse` / `ic_gamepad` | Input (gamepad post-v1) | Keyboard / mouse / gamepad outlines |
| `ic_accessibility` | Accessibility | Person in a circle, arms out |
| `ic_reduce_flashing` | Reduce flashing | Bolt inside a circle with a down arrow |
| `ic_reduced_motion` | Reduced motion | Wave flattening into a line |
| `ic_colourblind` | Colour-blind presets | Eye whose iris is split in two halves |
| `ic_ui_scale` | UI scale | Small "a" and large "A" drawn as strokes |
| `ic_graphics` | Graphics quality | Monitor with three slider bars |
| `ic_particles` | Particle cap | Seven dots in a burst pattern |
| `ic_mayhem` | Unlimited Mayhem | Infinity sign with a spark at one end |
| `ic_shake` | Camera shake | Camera with zig-zag lines either side |
| `ic_chevron_up` / `_down` / `_left` / `_right` | Chevrons | 8 px chevron |
| `ic_plus` / `ic_minus` / `ic_check` | Generic | Plus / minus / check |
| `ic_more` | More | Three vertical dots |
| `ic_drag` | Drag handle | 2 × 3 dot grid |
| `ic_external` | External link | Square with an up-right arrow |
| `ic_pin` / `-fill` | Pin / dock panel | Push pin |
| `ic_refresh` | Reload | Circular arrow |
| `ic_expand` / `ic_collapse` | Drawer | Two outward / inward chevrons |
| `ic_sort` | Sort | Up and down arrows side by side |

**Count:** 14 + 27 + 29 + 32 + 8 + 24 + 14 + 14 + 27 + 19 + 15 + 32 = **255 icon IDs**: 248 drawings + 4 `-fill` variants + 3 Library-tab aliases. Plus 24 emote glyphs (§2.12) and 12 channel glyphs (§3).

---

## 3. Channel glyphs (12)

**Filled** shapes (GAME_SPEC §6.6, §9.4), always paired with the channel colour (§9.2) but recognisable by shape alone; colour-blind presets swap colours, never shapes. Drawn on the 24 grid; hand-tuned 12 px and 16 px versions for port labels, chips and timeline markers.

| Channel | Colour | Glyph | Shape spec (24 px) |
|---|---|---|---|
| Impact | `#F2F4F8` | ✸ | 8-point burst star: long points radius 10, short points radius 5.5, tips rounded 1 px |
| Signal | `#FFC21A` | ◆ | Diamond 16 wide × 20 tall, corners rounded 1.5 px |
| Spin | `#A78BFA` | ⟳ | 300° clockwise arc, 4 px thick, outer Ø 18, ending in a filled arrowhead 8 px wide |
| Tension | `#E0A96D` | ∿ | 1.5-period sine wave across 20 px, 4 px thick, round ends |
| Power | `#C6FF3A` | ⚡ | Two-segment lightning bolt 14 × 20 with sharp inner corners (the one icon allowed sharp points) |
| Light | `#FFF1A8` | ☀ | Disc Ø 8 with 8 rays (2 × 4 px rounded bars) between radius 7 and 10 |
| Heat | `#FF5B2E` | 🔥 | Teardrop flame 16 × 20 with an inner tongue-shaped counter (min 3 px) |
| Air | `#9BE7D8` | ≋ | Three stacked wavy lines 18 px wide, 2.5 px thick, 3 px gaps, curled right ends |
| Fluid | `#4C8DFF` | 💧 | Drop: Ø 14 circle at the bottom drawn up to a point at y = 2 |
| Sound | `#F472B6` | ♪ | Eighth note: oval head 7 × 5.5 tilted −20°, 2 px stem, one curved flag |
| Lure | `#34D399` | ◎ | Bullseye: ring outer Ø 20 / inner Ø 13 + centre dot Ø 6 |
| Field | `#FF3DAE` | ⊛ | Ring outer Ø 20, 2.5 px thick, with a 6-arm asterisk inside (arms 2.5 px, rounded ends) |

- **Chip:** 20 px tall pill, `slate` fill, glyph 16 px in the channel colour + label in Inter Medium 12 px Paper. Inverse chip (selected): channel-colour fill, glyph and label in Void.
- **Silhouette test:** all 12 filled black at 12 px must be nameable; no two share a bounding shape (star, diamond, arc, wave, bolt, rayed disc, flame, stacked waves, drop, note, bullseye, ringed asterisk).
- **Multiplayer:** Field's colour is Player 2's, so in X-ray and timeline overlays Field switches to its glyph plus a dashed pattern (MULTIPLAYER §8.1). The glyph itself never changes.
- Also exported to the decal atlas (shared_kit.md §6.1, region D) and the in-world MSDF atlas.

---

## 4. Brand mark

### 4.1 Wordmark
| Spec | Value |
|---|---|
| Text | **KNOCK-ON**, all caps |
| Typeface | *Unbounded* **Black** (900), SIL OFL |
| Tracking | −10 / 1000 em, manual kerning on K-N, C-K and O-N |
| Hyphen | Replaced by the **Ignition spark streak** (§4.2). Never a typed hyphen |
| Colour on dark | Letters Paper `#EEF1F6` on Void `#0B0D12` or Graphite `#12151C` |
| Colour on light | Letters Graphite `#12151C` on Bone `#E8E2D6` or white |
| Spark | Always Ignition-based (§4.2), on dark and light |
| One-colour | All Paper or all Graphite (spark included) for embossing and single-ink print |
| Clear space | 1 × cap height (H) on all sides |
| Minimum size | 96 px wide on screen (H ≈ 12 px), 20 mm in print. Below 160 px wide the spark drops its ticks |

### 4.2 The spark streak (units of cap height H)
- Occupies the hyphen's slot with 0.08 H side bearings; total length **0.9 H**; centred at 0.47 H above the baseline; **rises 8°** left to right.
- Comet profile: 0.04 H thick at the left tail → 0.16 H at the right head; the head is a rounded disc Ø 0.2 H.
- Fill: linear gradient along the streak, Ignition `#FF5B2E` for the first 70 % → hot core `#FFC870` at the head; a Ø 0.1 H `#FFC870` core dot in the head.
- Three spark ticks: 0.12 H long, 0.03 H thick, round caps, `#FF8A2A`, radiating from the head at −40°, +10° and +60°, starting 0.05 H off the head.
- The same streak is reused by `ic_let_it_rip` and the boot loader.

### 4.3 Lockups and motion
- **Primary:** horizontal wordmark. **Tagline lockup:** wordmark + "Every action has an overreaction." in Inter Medium at 0.32 H, Fog, 0.5 H below, left-aligned.
- **Ignite animation** (boot, title): the streak draws tail-to-head in 300 ms, then the ticks flicker 3 times over 450 ms. With Reduce flashing or Reduced motion, ticks fade in once instead.

### 4.4 App mark
- A Graphite `#12151C` rounded square (corner radius 22 % of the size) with a Paper **K** (Unbounded Black, 62 % of the height, optically centred 4 % left) and the spark streak at hyphen height to its right, its head breaking 6 % past the right edge.
- Sizes: favicon 16 / 32 / 48 (at 16 px: the K + a 2 px Ignition bar, no streak taper), PWA 192 and 512 (maskable: content inside the central 80 %). Replaces the "◧" placeholder in the top bar at 20 px.

### 4.5 3D logo (title scene and Photo mode watermark)
- Extruded wordmark, depth 0.18 H, bevel 0.02 H (3 segments). Letters `kn_powder_bone`, spark `kn_led` emissive driven Ignition → `#FFC870`, sitting on a graphite plinth with rubber feet. LOD0 ≤ 20k tris. `assets/src/ui/brand/knockon_logo3d.blend`.

### 4.6 Files and don'ts
- `assets/src/ui/brand/knockon_wordmark_{dark,light,mono_paper,mono_graphite}.svg`, `knockon_mark.svg`, `favicon.ico`, `pwa-192.png`, `pwa-512.png`.
- Letters are outlined in the SVG (no font dependency). Keep the editable source with live text in `knockon_brand.fig` or `.svg` with a text layer.
- **Don't:** colour letters in brand accents, use a plain hyphen, add outlines, drop shadows or gradients to letters, stretch, or rotate. The name is pending a trademark check (GAME_SPEC §22): the spark device is the asset to protect; if the name changes, the streak becomes the underline accent of the new wordmark.

---

## 5. Cursor set

| Spec | Value |
|---|---|
| Size | **32 × 32 px** at 1×, 64 × 64 at 2× (CSS `image-set`); hotspots below are 1× pixel coordinates |
| Style | Paper `#EEF1F6` fill, 1.5 px Void `#0B0D12` outline, baked shadow (0, 1) blur 2 px at 40 %. Accent details in Beam (valid) or Danger (invalid) |
| Format | SVG source → PNG @1× / @2×. CSS: `cursor: image-set(url(c.png) 1x, url(c@2x.png) 2x) x y, <fallback>` |
| Snap step label | Not baked: the UI draws "10 cm" in JetBrains Mono 11 px, Fog on a Void 70 % pill, offset (+18, +18) from the hotspot (GAME_SPEC §5.2) |
| Partner cursor | Not an OS cursor: the in-world laser dot in the player colour (§8) |

| ID | Use | Shape | Hotspot | Fallback |
|---|---|---|---|---|
| `cur_default` | Default | Arrow | (3, 2) | `default` |
| `cur_pointer` | Clickable UI | Pointing hand | (11, 3) | `pointer` |
| `cur_grab` / `cur_grabbing` | Draggable / dragging (panels, timeline) | Open / closed hand | (16, 16) | `grab` / `grabbing` |
| `cur_place` | Place tool, valid | Crosshair with a small plus at lower right | (16, 16) | `crosshair` |
| `cur_place_blocked` | Place blocked (red ghost) | Crosshair + Danger slashed circle | (16, 16) | `not-allowed` |
| `cur_select` | Select tool | Arrow with a small box | (3, 2) | `default` |
| `cur_box_select` | Box select drag | Crosshair with a dashed rectangle | (16, 16) | `crosshair` |
| `cur_move` | Move gizmo hover | Four-way arrow | (16, 16) | `move` |
| `cur_rotate` | Rotate gizmo hover | Circular arrow | (16, 16) | `alias` |
| `cur_resize_ns` / `_ew` / `_nwse` / `_nesw` | Resize | Double arrows | (16, 16) | `ns-resize` … |
| `cur_path` | Path tool | Pen nib | (4, 28) | `crosshair` |
| `cur_path_add` / `cur_path_end` | Add point / finish | Pen nib + plus / + check | (4, 28) | `crosshair` |
| `cur_brush` | Brush tool | Ring with a centre dot (the in-world brush footprint shows the size) | (16, 16) | `crosshair` |
| `cur_wire` | Wire tool | Plug | (5, 5) | `crosshair` |
| `cur_wire_ok` / `cur_wire_bad` | Over a compatible / incompatible port | Plug + Beam ring / + Danger slash | (5, 5) | `copy` / `no-drop` |
| `cur_measure` | Measure | Crosshair + small ruler | (16, 16) | `crosshair` |
| `cur_terrain_raise` / `_lower` / `_flatten` / `_smooth` | Terrain brushes | 6 px ring + ▲ / ▼ / ▬ / ∼ | (16, 16) | `crosshair` |
| `cur_orbit` | Orbiting (RMB) | Two arcs around a dot | (16, 16) | `move` |
| `cur_pan` | Panning (MMB) | Open hand with four tiny arrows | (16, 16) | `all-scroll` |
| `cur_zoom` | Zoom drag | Magnifier | (13, 13) | `zoom-in` |
| `cur_fly` | Fly mode | 4 px dot in a 10 px ring | (16, 16) | `none` |
| `cur_poke` / `cur_poke_grab` | Poke mode hover / holding a body | Finger tap / pinching hand | (10, 3) / (16, 12) | `pointer` |
| `cur_ping` | Placing a ping | Map pin | (16, 30) | `crosshair` |
| `cur_text` | Text fields | I-beam | (16, 16) | `text` |
| `cur_busy` | Working (static; the UI shows a spinner) | Cog | (16, 16) | `progress` |
| `cur_not_allowed` | Not allowed | Danger slashed circle | (16, 16) | `not-allowed` |

**Count: 36 cursors.**

---

## 6. Library card thumbnail rig

These renders are the **3D part icons used everywhere in the UI** (parts tray, Library cards, Inspector header, palette results, event feed, Cascade Report; [D77](../../dev/DECISIONS_2026-10-24.md)). They are rendered in Blender by **`tools/blender/render_thumbs.py`** ([D78](../../dev/DECISIONS_2026-10-24.md)), matched to the engine look, and written to `<type>.thumb.webp` (ASSET_PIPELINE §8). The live hover turntable stays in-engine.

`blender -b --factory-startup -P tools/blender/render_thumbs.py -- <out_dir> [--types thud,motor,...] [--size 512] [--crop128] [--warm] [--tactile] [--samples N]` renders from the *exported* `.glb`s and writes `<out_dir>/<type>.thumb.webp` (or `<type>.thumb_128.webp` with `--crop128`), lossless with alpha.
- `--warm` uses the **Tinker Lab** light variant (warm window key, golden rim, cool fill), the one every UI use ships with; without it the rig is the neutral Studio Light variant with the shipped masters, kept for colour QA.
- `--tactile` renders with the look-dev stand-ins for the D78 texture sets (`tools/blender/_tactile.py`, shared_kit.md §7.2) until a part has its real set.
- `--types` limits the run to some parts; `--size` and `--samples` set the output size and Cycles samples; `--crop128` uses the tighter 128² framing (88 %).
- Critters are skipped (they get their own card art, critters.md). The script renders straight at the output size; the 2×-then-Lanczos step in the table below is left to `tools/bake`.
- Look-dev output: `art/style-samples/icons/` (28 warm tactile part icons, 256², `.thumb.webp`).

| Spec | Value |
|---|---|
| Environment | **Warm (Tinker Lab) variant, the default:** a warm window key (the Tinker Lab sun, ≈ 3,500 K), a golden rim and a cool fill (environments.md §3.4; exact values live in the script), fixed exposure, Khronos PBR Neutral. **Neutral variant:** THE STUDIO **Light** rig (environments.md §1.4), Studio IBL, for colour QA |
| Background | **Transparent.** The cyc is not rendered; a shadow catcher under the part writes a soft contact shadow into alpha (35 % opacity, 12 px blur at 512²) |
| Camera | Front-right three-quarter: **azimuth 30°** from the front (−Y) toward +X, **elevation 20°** (the turntable angle, shared_kit.md §9.4), vertical FOV 24° |
| Framing | Bounding sphere fills **80 %** of the frame height, centred on the bounding-box centre, shifted up 6 % to leave room for the shadow |
| Pose | The part's `kn_card_pose` custom property if present (e.g. Helio inflated, Fulcrum tilted −12°, Bangstick fuse curled, Gotcha Box closed); otherwise its idle state |
| LEDs and screens | Port rings and LED groups at "active" 100 % with bloom limited to a 4 px radius; screens show a representative value (Ringer "00:30", Cell bar 80 %) |
| 512² card | Rendered at 1024², downsampled with Lanczos-3 (the downsample is a `tools/bake` step; `render_thumbs.py` renders at the output size) |
| 128² card | Rendered separately at 256² with the bounding sphere at **88 %** (`--crop128`; tighter crop for legibility), downsampled, unsharp mask 0.4 |
| Output | `assets/build/parts/<type>/<type>.thumb.webp` (512²) and `<type>.thumb_128.webp` (128²), WebP lossless with alpha (ASSET_PIPELINE §2, §8) |
| Variants | One pair per skin (`<type>.<skin>.thumb.webp` + `<type>.<skin>.thumb_128.webp`) |
| Critters | Idle pose with the `happy` face; accessories visible (own card art; `render_thumbs.py` skips them) |
| Matter emitters | Shown filled (sand in the Grit Hopper, water in the Tank) |
| Modules | Same rig, framed on the module's bounds; ports facing the camera where possible |
| Loading and live turntable | Per UI_UX §4.4 and §8: cards show the static 128² thumb first, then the 512² thumb on hover (or at once on HiDPI screens). On hover the card loops a live in-engine turntable: 12 s per revolution, same elevation and FOV, one 256² offscreen view. At most 24 live views at once (older ones fall back to the static thumb) |
| Card chrome (UI) | Card about 180 × 212 px (UI_UX §4.4) on a glass well (`--surface-well`; Graphite `slate` in the solid fallback), 16 px radius, 1 px `glass-edge` border, the icon on a warm radial glow, name in Unbounded 14 px, type tag in Inter 12 px Fog, channel glyphs (§3, in → out). Selected: `beam` outline |
| QA | Each thumb passes the 150 px colour-read test (ART_BIBLE §1) on dark glass and on the solid fallback, in both light variants |

---

## 7. Loading and empty-state illustrations

### 7.1 Style
- Large illustrations are **in-engine renders of real game assets**, set up as small `.knockon` scenes in `assets/src/ui/illustrations/<name>.knockon` and rendered by `tools/bake` with the Studio Light rig on a transparent background, three-quarter view, elevation 20°. They update automatically when assets improve.
- Output: 640 × 400 @1× and 1280 × 800 @2× WebP with alpha, ≤ 80 KB @1×. Shown on glass panels (Void / Graphite in the solid fallback).
- Text under each: headline Unbounded Bold 20 px Paper, body Inter 14 px Fog, one action button (secondary style unless noted).
- Small panel empty states (Outliner, History, Notes) use a 48 px line icon (§1) instead of a render.

### 7.2 Loaders

| Loader | When | Spec |
|---|---|---|
| **Boot loader** | Before WebGPU is up (no engine yet) | Pure inline SVG + CSS, ≤ 12 KB. Centred wordmark (§4) with the ignite animation. Below it the **burning-fuse progress bar**: 320 × 6 px track; a 2 px fuse cord `#4A3524` burns left to right with the spark streak head at the progress point and 6 CSS spark dots; the burnt part fades to `steel` `#2A303D`. Label "Lighting the fuse… 42 %" in Inter 12 px (`--fs-sm`) Fog with JetBrains Mono numerals. Reduce flashing / Reduced motion: static head, no spark dots |
| **World loader** | Engine up, world and assets streaming | 480 × 270 in-engine vignette on the dark cyc: 12 Topple Tiles toppling into a Bangstick whose fuse fizzles out (never explodes), 6 s loop; the fuse bar below |
| **MP catch-up** | Joining a run in progress ("Catching up… 8.2 s") | Fuse bar + the partner's `ic_player` in their colour at the head |

### 7.3 Empty states

| # | Where | Illustration | Headline / body | Action |
|---|---|---|---|---|
| 1 | New empty world (first open) | Thud on its plinth, a dotted arc arrow toward an empty spot | "Drop a THUD to start" / "Pick a part from the dock or the Library." | Open Library |
| 2 | Library search, no results | Dusty bumping into an empty, dashed part card | "No parts match" / "Try another word or clear the channel filters." | Clear filters |
| 3 | Modules tab empty | Open crate with a Cog peeking out | "No modules yet" / "Select a gadget, then Save as Module." | — |
| 4 | Favourites empty | Pip holding a Volt star | "Star parts to keep them here" | — |
| 5 | My Machines empty | A Fulcrum on a blueprint card | "Your machines live here" | New world (primary) |
| 6 | Lobby, no live session | Biscuit asleep with `fx/critter_zzz` | "Nobody's here yet" / "Start a world, or wait for your friend." | New world (primary) |
| 7 | Cascade Report with K.O. 0 | Mochi yawning beside one unfallen Topple Tile | "Nothing knocked on" / "Try a heavier start." | Back to build |
| 8 | WebGPU unavailable page | Dusty facing a wall with an `em_question` bubble | "Your browser can't run KNOCK-ON yet" / link to `/check` + capture reel | Open /check |
| 9 | Connection to host lost | Two port rings with a dangling unplugged cable | "Lost the host" / "Reconnecting…" | Retry |
| 10 | Build mismatch | Buzz holding a parcel, `em_alert` bubble | "The host updated the game" / "Reload to keep playing together." | Reload (primary) |
| 11 | Over capacity ("Needs 16 GB tier") | Big Top cannon overflowing with Thuds | "This world needs the 16 GB tier" / "Your GPU (or your partner's) is on a smaller tier." | Open settings |
| 12 | Outliner empty | 48 px `ic_outliner` | "Nothing placed yet" | — |
| 13 | History empty | 48 px `ic_history` | "No saved versions yet" | — |

---

## 8. Player drone avatar (multiplayer)

### MP DRONE: partner presence avatar
`mp_drone` · In-world UI · Class S · Ship M1 · Inspired by (internal only): none (a camera drone, deliberately distinct from Buzz)

**Concept.** Your friend's camera, shown as a small friendly camera drone in their colour: a round camera ball in their player colour with one big lens looking where they look, four Bone ducted rotors, and a glowing LED band. It must read instantly as "my friend is looking from here", never as a part or as BUZZ the courier-drone critter. Buzz is a flat Bone pebble with Graphite ducts, white duct rings, a Beam visor face, an Ignition pennant on a whip antenna, skids and a cargo claw, and it never wears a player colour (critters.md); the drone inverts that livery and drops every one of those features (see **Distinct from Buzz** below).

| Spec | Value |
|---|---|
| Size (W×H×D) | 0.24 × 0.10 × 0.20 m at 1 : 1 · origin: lens centre = the partner's camera position · front (−Y) = look direction |
| Screen clamp | Never smaller than 28 px or larger than 110 px across on screen; scales with distance in between, so it stays findable in a 1 km world |
| Mass · physics | None. No collision, not in the sim, never saved, ignored by raycasts, snapping and the Wire tool |
| Collision | none |
| Materials (60/30/10) | neutral: `kn_powder_bone` ducts and arms · signature: `kn_anod_beam` (Player 1) or `kn_anod_plasma` (Player 2) camera ball · accent: `kn_led` band, `kn_glass` lens over a `kn_powder_graphite` barrel, `kn_rubber` duct bumpers, `kn_poly_clear` rotor blur discs |
| Player colours | **Player 1 Beam `#2FD6FF`, Player 2 Plasma `#FF3DAE`** (MULTIPLAYER §8.1). Swapped per slot by material variant, no texture |
| Pieces | Camera ball Ø 0.10 m (a sphere, not a flat pod) · lens barrel Ø 0.05 m protruding 0.02 m, iris ring · 4 ducts Ø 0.07 m at the corners on short arms, level with the ball's equator · LED band around the ball's equator · antenna nub (≤ 15 mm, no pennant) with a tip LED · `EMIT__laser__lens` at the lens · name-tag anchor 0.09 m above |
| Pivots | `PIVOT__rotor_fl/fr/bl/br` (axis z, continuous) · `PIVOT__body` (tilt, ±15°) · `PIVOT__iris` (scale 0.7–1.0) |
| LEDs | `led_groups = "0:band,1:antenna,2:lens_ring"` · band in player colour · antenna tip blinks on chat typing · lens ring pulses on placements |
| States | **Idle:** band 60 %, bob ± 0.02 m at 0.5 Hz, rotors blurred · **Moving:** tilts into velocity (critically damped, 0.25 s), band 80 % · **Building:** tool icon on the name tag, lens ring pulse per placement · **Holding a part:** laser on, ghost preview in player colour · **Pinging:** band to 100 % twice (150 ms each) · **Chatting:** antenna blinks 2 Hz while typing · **Away > 60 s:** rotors slow, band 30 % · **Reconnecting:** band Amber 1 Hz, drone 50 % transparent · **Run countdown:** band shows 3-2-1 as three segments |
| Animation | Procedural only (rotor spin, tilt, bob, iris). Driven by 20 Hz presence updates, interpolated (MULTIPLAYER §6) |
| Laser cursor | Lens → the partner's cursor hit point: 2 mm white core at 60 % + 8 mm glow in the player colour at 70 %. End dot Ø 0.02 m (min 10 px) with a thin ring. Occluded segments draw dashed at 30 % |
| Name tag | Screen-space billboard 0.09 m above: 24 px pill, `slate` `#1B1F29` at 90 %, 1 px `steel` border, 3 px left bar in the player colour, player initial 18 px circle, name in Inter Semibold 14 px (`--fs-md`) Paper, current tool icon 16 px Fog at the right. 50 % when behind geometry; hidden within 2 m of your camera |
| Proximity | Dither-fades within 1.5 m of the local camera, and whenever it would cover your cursor |
| Off-screen arrow | 28 px chevron in the player colour, inset 24 px from the screen edge, with a 16 px `ic_player` and the distance in JetBrains Mono 11 px ("42 m") |
| Ghost preview | Placing part rendered in the player colour at 35 % with a 70 % fresnel edge |
| Selection and locks | 2 px **solid** outline in the player colour + a small name chip. Solid player-colour outlines are reserved for players; Field effects use patterns ([vfx.md §0.4](vfx.md#04-vfx-palette-art_bible-11)) |
| Ping markers | Billboard pin 32 px: player-colour pill containing the ping glyph (`ic_ping_look/help/nice/boom`), plus two ground rings pulsing 0.5 → 1.5 m over 0.6 s. Visible through walls for **4 s** (occluded at 60 % with an outline), fade over the last 0.5 s. "Boom incoming!" adds an Amber ring that shrinks over the 4 s |
| Distinct from Buzz | Checked at the 28 px screen clamp, next to Buzz: **round** ball vs Buzz's flat pebble · body in the **player colour** vs Buzz's Bone (Buzz never uses Beam or Plasma) · **Bone** ducts vs Buzz's Graphite ducts with white rings · one big **lens** vs Buzz's visor face · **no** skids, claw, winch, pennant or whip antenna · no collision, screen-clamped size. Never call it "Buzz-style" in docs or UI |
| Budget | LOD0 4,000 tris · LOD1 2,000 · LOD2 800 · LOD3 250 · no unique textures (masters only) |
| Audio hooks | Soft rotor hum (3D, 8 m radius; Player 2 pitched +3 semitones) · ping chirp per kind · join chime · leave chime |

**Read at a glance.** A player-coloured ball with one bright lens between four Bone ducts: "my friend's camera". **Notes / don'ts.** No face, eyes or mouth beyond the single lens. Nothing weapon-like. In multiplayer, Beam and Plasma as solid fills and outlines **in the 3D world** belong to players only (MULTIPLAYER §8.1). DOM UI keeps Beam as its selection and focus colour (§1, GAME_SPEC §9.2).
