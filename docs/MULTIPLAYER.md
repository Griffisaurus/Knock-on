# KNOCK-ON: Multiplayer Design (2-player co-op)

Status: v1.1 · 2026-10-25 (as built through M5; shipped in M1, extended in M3–M5) · Companion to [GAME_SPEC.md](../GAME_SPEC.md). Local setup is in [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md). Player-facing behaviour is in [HOW_TO_PLAY.md](HOW_TO_PLAY.md). Code: `packages/net/src/protocol.ts`, `apps/host/src/` (`server.ts`, `session.ts`, `storage.ts`, `share.ts`), `apps/game/src/net.ts`, `apps/game/src/run.ts`.

> **As built:** the design below shipped in M1 and passes the 2-player soaks every milestone (M4: 15 runs, 75k ticks, 0 desyncs, with 8 Jolt threads). Differences from the draft are marked *As built* in place; the protocol tables in §10 match `protocol.ts`.

---

## 1. Goals and non-goals

**Goals**
- Two friends build one machine together in real time, then watch it run together, seeing the exact same cascade.
- The local Host Server coordinates up to two browser clients.
- The protocol remains usable with simulated latency for deterministic multiplayer testing.
- Multiplayer is part of the core data model from day one, not bolted on later.

**Non-goals (v1)**
- More than 2 builders (spectators are a stretch goal, §12).
- Matchmaking, public lobbies, accounts, NAT traversal, or deployment outside the local computer.
- Competitive modes or anti-cheat. You're playing with a friend.
- Built-in voice chat.

---

## 2. Why this is cheap for us: determinism

The simulation is deterministic (GAME_SPEC §6.3). The same machine plus the same inputs produce the same result on every machine. So:

- **Build mode** is a shared document. The host server puts every edit into one global order, and both clients apply the same ordered edits, so both hold an identical machine.
- **Run mode** needs **no physics streaming**. Each client simulates locally. The only things on the wire during a run are playhead control, rare "pokes" (with a target tick), and periodic state hashes to prove both clients agree.
- Network traffic stays **under ~10 KB/s** even for a 1M-part Megastructure run.

---

## 3. Topology

```
 Browser tab A ──┐
                 ├──▶ http://localhost:8787 ──▶ KNOCK-ON Host Server (Node)
 Browser tab B ──┘                                • static game build
                                                   • /ws session relay + ordering
                                                   • world storage + journal + backup
```

- **The Host Server is not a game server.** It runs no physics and no rendering. It does six things:
  - serves the static game build (with the COOP/COEP headers that WebGPU threads need);
  - puts edits in order, then validates and relays them;
  - manages part locks;
  - relays presence, chat and pings;
  - coordinates Run start, stop and the playhead;
  - persists worlds.

  It needs about 100 MB of RAM and essentially no CPU.
- Browsers treat `http://localhost` as a secure context for development. The server also sends the cross-origin-isolation headers required for WebGPU threads.
- The server binds **127.0.0.1 only** and does not trust identity headers from upstream proxies.

---

## 4. Session model

| Concept | Definition |
|---|---|
| **Host Server** | One process, holding a library of saved worlds and at most **one live session** |
| **Session** | One open world plus up to 2 connected players. It lives while the server runs, and its state persists to disk continuously. |
| **Host player** | The first player to join. Can switch worlds, kick, and change server settings. Acts as the **sync authority** (§7.4). |
| **Guest** | The other player. Equal building rights. |
| **Player slot** | 1 or 2. Fixes the player colour (§8.1) and the ID namespace (§5.3). |

Both players are full builders. There are no permission tiers beyond the host's admin actions.

---

## 5. Build mode: shared document

### 5.1 Ops
Every change to a world is an **op**. The local editor never mutates the world directly. It emits ops, which are applied through one code path (also used for undo, load and replay). Op names match the `Op` union in ARCHITECTURE §4.2; the binary encoding (numeric op tags) is in DATA_FORMATS §3.

| Op | Payload |
|---|---|
| `PartAdd` | `id`, `type`, `transform` (quantized), `size`, `props`, `layer`, `group` |
| `PartUpdate` | `id`, sparse `patch` (transform, size, props, mirror, lock flag, layer) |
| `PartRemove` | `ids[]` |
| `LinkAdd` / `LinkUpdate` / `LinkRemove` | Lines, Bands, wires, Fuses, Tubes, Glidepaths: endpoints (`partId`, `port`) and spline control points |
| `GroupSet` / `LayerSet` / `ModuleSave` / `ModulePlace` | Grouping, layers and module (prefab) operations |
| `EnvUpdate` | Gravity, air, feel, environment; also `sinkFill` (M4, D98), and, in M5, `zones` (Hangar zero-g on/off), `wind` (global wind, D26), `baseLights` (Moon, cosmetic) and `matter` (the per-world Matter switch) |
| `TerrainStroke` / `TerrainPatch` | Backlot only: brush type, radius, strength, the sampled stroke path (applied deterministically); a patch restores samples (a stroke's undo) |
| `NoteAdd` / `NoteUpdate` / `NoteRemove` | Sticky notes |
| `Batch` | An atomic list of ops (paste, brush strokes, module place, multi-select drag) |

### 5.2 Ordering and optimistic apply
1. The client applies its op **locally right away** (optimistic) and sends `op {clientOpId, baseSeq, op}`.
2. The server validates it (parts exist, not locked by the other player, within capacity limits). It then assigns the next global **`seq`**, appends to the journal, and broadcasts `op {seq, by, op}` to both clients. The sender also gets `op.ack {clientOpId, seq}`.
3. Clients keep a **confirmed state** (all ops ≤ last seq) plus a queue of **pending local ops**. When a remote op arrives, the client re-applies its pending ops on top. This is cheap because ops are small and pending queues are usually 0–3 long.
4. On `op.reject {clientOpId, reason}` the client drops that op and its dependants and shows a small toast ("Biscuit-Fan is holding that part").
5. *As built:* an op over the 200 ops/s limit is answered `op.reject {reason: RATE_LIMIT}`, never dropped silently, and clients pace sends at 150/s (D65).

On the local computer, round trips are typically about 1 ms. The soak tests add 40–80 ms of one-way latency to exercise optimistic apply and rollback behavior.

### 5.3 IDs
Part, link and note IDs must be identical on both clients, because **the sim orders everything by ID** (GAME_SPEC §6.3). Each client allocates IDs from its own namespace, so there are never collisions and no server round trip:
`id = slot × 2³² + counter` (a safe integer in JS). The counter is persisted per world per slot. On save, IDs are kept as-is. Sim order only needs IDs to be unique and stable, not dense.

### 5.4 Soft locks
- Grabbing or selecting a part takes a **lock** on it (`lock {ids}`). The other player sees a coloured outline and a small name tag on it, and can't move or edit it.
- Locks release on deselect, after 10 s idle, or on disconnect.
- Path and brush strokes lock the parts they create until the stroke ends.
- The rare race where both grab at the same time is resolved by server order: the first `lock` wins, and the loser's optimistic drag snaps back with a soft "boop".

### 5.5 Undo and redo
- **Per player.** Ctrl+Z undoes *your* last op, never your friend's.
- Each op stores its inverse when it is applied. Undo sends the inverse as a new op. *As built:* as an ordinary `op` message (`NetClient.undo`, `apps/game/src/net.ts`); there is no separate `undo` message, and the conflict check runs in the client's DocStore.
- If your friend has since changed the same object (a later op touches the same ID), that step is **skipped** with a toast ("Can't undo, Sam moved it since"). Undo then continues with your next step.

### 5.6 Capacity
The session's capacity is the **lower of the two players' GPU tiers** (GAME_SPEC §15.2). Both clients report their tier in `hello`. The server rejects ops that would exceed the session cap, such as placing part #400,001 when the guest is on a 12 GB tier. The lobby shows the session tier.

*As built:* the host accepts tiers 4, 8, 12, 16 and 32 in `hello`, and its part caps (`TIER_CAPS` in `apps/host/src/session.ts`) come from the format's single tier table (`packages/format/src/matter.ts`): 20k / 100k / 400k / 1M / 2M. Until M5 the host had its own table without the 32 GB entry, which capped a 5090 session at 20,000 parts; fixed with a regression test (D107). Grain budgets don't gate ops: a world records `counts.grains` and `requiredTier`, and a client below that tier is warned at run start (`run.ts`).

---

## 6. Presence and communication

| Feature | Behaviour | Rate |
|---|---|---|
| **Partner drone** | Your friend's camera is a small hovering camera drone (deliberately distinct from the Buzz critter; art/briefs/ui_icons.md §8) in their colour with a name tag, so you can see where they're looking | 20 Hz, interpolated |
| **Laser cursor** | A thin beam from their drone to their 3D cursor hit point | 20 Hz |
| **Ghost preview** | The part they're placing shows as a translucent ghost in their colour | On change |
| **Selection** | Their selection and locks are outlined in their colour | On change |
| **Pings** (G, or hold G for a radial) | Look here · Help · Nice! · Boom incoming! A 3D marker plus a sound, visible through walls for 4 s | On use |
| **Chat** (/ to open, Enter to send) | Small text chat in the corner. The last 3 lines fade in during a run. Not on Enter alone, because Enter picks up and places parts in keyboard building (GAME_SPEC §20) and finishes paths | On use |
| **Follow / Spectate** | Snap your camera to theirs (F2), or keep following it while orbiting freely around their focus (F3) | — |
| **Partner off-screen** | An edge-of-screen arrow points to their drone | — |

*As built:* the partner drone, ghost preview, selection and lock outlines, pings (G) and chat (/) are in. Since D124 the ghost preview shows every part the partner holds (drag, gizmo, paste; up to 32), turned as they turn it, and their tag reads "holding 5 parts". Not built yet (HOW_TO_PLAY §13): the laser cursor, the ping radial, Follow / Spectate (F2 / F3), the off-screen arrow and the held-part outline.

---

## 7. Run mode together

### 7.1 Starting a run
- Either player presses **LET IT RIP**, which starts a **3-second shared countdown** on both screens. Either player can cancel it (Esc).
- At zero, the server broadcasts `run.start {runId, worldSeq}`. Both clients build the run from the **confirmed** world at `worldSeq` (`DocStore.confirmed()`, without their own unacknowledged edits, D72) and start simulating.
- During a run, editing is disabled for both players (same as single player).
- **Stop** (either player) returns both to Build mode at the exact pre-run state.

### 7.2 Shared playhead
- Both clients simulate and **bake ahead independently** (GAME_SPEC §6.5). Each reports `bakedTick` at 4 Hz.
- The **shared playhead** shows the same moment on both screens. It's driven by a server-relayed state `{runId, tick, speed, paused, atServerTime}`, and clients convert it to local time using a clock offset measured by ping exchanges (NTP-style, median of 8).
- The playhead never passes `min(bakedTick of both)`. If one PC is slower (time dilation), both slow down together, and the HUD shows "SIM 0.4× · waiting on Sam".
- *As built (`apps/host/src/session.ts` `onBaked`, M5, [D108](dev/DECISIONS_2026-10-24.md)):* the host keeps each connected player's highest `baked` tick and broadcasts `bakedMin` whenever the minimum differs from **the last value it broadcast** for the run. So a partner whose worker hasn't reported `baked` yet (still loading Jolt) holds everyone at 0, and the first real report releases them. Before M5 it broadcast only when the minimum changed from the previous minimum, which never happened while a partner sat at 0, so the faster client played on unconstrained, up to 1,000+ ticks ahead. A client plays unconstrained only until the first `bakedMin` of a run arrives.
- **Controls are shared:** pause, speed, step and scrub from either player apply to both, with an attribution toast ("Sam: 0.25×").
- **Cameras are independent.** Each player can use any camera (director, ride-cam, drone), or Follow their partner.

### 7.3 Pokes (Hand-of-God during a run)
- A poke is an input: `{runId, tick, partId, kind, data}`, where `kind` is `impulse | drag | release` and `data` is the quantized impulse or drag target (the `Poke` record in DATA_FORMATS §5).
- The client sends it with `tick = sharedPlayheadTick + inputDelay`, where inputDelay is 12 ticks (100 ms at 120 Hz) on direct connections and up to 36 ticks (300 ms) on relayed ones, chosen from measured RTT. 60 Hz machines use the same delays in milliseconds (6–18 ticks).
- The server orders pokes, appends them to the run's **input log**, and broadcasts them.
- A client that has already baked past `tick` **rolls back** to the nearest checkpoint (≤ 0.5 s earlier; up to 2 s when the Matter layer is active, SIMULATION §11), applies the poke, and re-simulates. This is invisible, because playback runs behind the bake head.
- The input log is saved with the world, so the run replays identically later. *As built:* the log lives in the session's run state (`RunState.pokes`), so a late joiner catches up with it; it isn't saved with the world yet (DATA_FORMATS §5).
- *As built:* hashes for tick T are reported only once the sim reaches T + 120 (D59, **amended by [D108](dev/DECISIONS_2026-10-24.md)**: D59 assumed a late poke always rewrites a hash before it's reported, which doesn't hold for the game client). The browser bakes up to 4 s ahead of the playhead, so a poke usually lands behind hashes already reported; each report therefore carries `pk` (how many pokes it was computed with), a client reports re-baked ticks again after a rollback, and the host compares a tick only across reports with the same `pk` (M5 desync fix, `packages/net/src/hashes.ts`, docs/dev/M5_NOTES_DESYNC.md). The start state is checkpointed too (D70).

### 7.4 Desync detection and repair
- Every 60 ticks, each client sends `hash {runId, tick, h, mc?, pk?}`: `h` is the 64-bit state hash (`Machine.hash()`), which **includes the Matter checksum, live counts, container contents and the Matter start tick when Matter is on** (so Matter-off goldens are unchanged); `mc` repeats the Matter checksum for diagnostics.
- If the hashes differ, the server sends `desync {tick}`. The **sync authority** (the host player, or the guest if the host is absent) uploads its nearest checkpoint, and the other client restores it and continues. The HUD shows "Re-synced at 12.4 s".
- **Checkpoint size and caps (as built, M4):** a checkpoint is a deflated KNCP container (JOLT + ECS + MATR, DATA_FORMATS §6). Only `checkpoint` messages may exceed the 4 MB message cap, up to `MAX_CHECKPOINT_MESSAGE_BYTES` = **64 MB** (`packages/net/src/protocol.ts`), matching the host's 64 MB WebSocket frame cap (`WS_MAX_PAYLOAD_MB`, `apps/host/src/server.ts`; `KNOCKON_WS_MAX_MB` overrides). The worker checks `MAX_CHECKPOINT_BYTES` (64 MB − 4 KB) before sending. **Measured:** a 1M-water world's checkpoint is **7.7 MB**, so roughly 8M settled grains fit; a bigger one can't be re-synced by checkpoint, so the authority reports "can't re-sync … over the limit" and the run carries on (`sim.worker.ts`). Rigid-only checkpoints are far smaller.
- A desync should write a **desync report** (world, input log, tick, both hashes, browser and GPU info) to `data/desync-reports/` on the host. *As built:* the host logs desyncs to its console, including whether the Matter checksums differ (`session.ts`); the report files aren't written yet. A desync means a determinism bug.

### 7.5 Solo preview (build without interrupting your friend)
- **Test-run selection** (Ctrl+Enter) and **Solo preview** (Shift+LET IT RIP) run *only on your machine*, on a snapshot of the world. Your friend keeps building and doesn't see it.
- Remote ops that arrive during your preview queue up and apply when you stop. You're told on stop if anything changed under you.
- This is the key co-op flow: one player tunes the domino run while the other wires the power room.

---

## 8. Identity and UX details

### 8.1 Players
- **Names:** supplied as player nicknames and stored in localStorage.
- **Colours:** Player 1 = **Beam** `#2FD6FF`, Player 2 = **Plasma** `#FF3DAE`. Selection outlines, drones, cursors, pings and chat names all use the player colour. These colours are reserved for players in multiplayer; the Field channel overlay switches to its glyph plus a dashed pattern so it isn't confused with Player 2.

### 8.2 Join flow
1. Open `http://localhost:8787` in two browser tabs. Both clients load from the same local build, which is required for determinism.
2. The lobby shows the live session (if any), the world library and thumbnails, the session GPU tier, and who's online.
3. Click **Join**. The server sends `snapshot` (world binary + current seq + locks + players + run state).
4. If a run is in progress, the client fast-forwards the sim from tick 0 using the input log ("Catching up… 8.2 s"), then joins the shared playhead.

### 8.3 Disconnects
- Short drops (≤ 30 s): the client keeps its pending ops and a resume token. On reconnect it receives the ops it missed (`since: lastSeq`) and resends its pending ops with their original `clientOpId` (the server de-duplicates them).
- Longer drops: a fresh snapshot. Locks held by the dropped player are released after 10 s.
- If the host's browser disconnects but the server keeps running, the guest can keep building. The guest becomes the temporary sync authority.

### 8.4 Version safety
`hello` includes `proto` (protocol version) and `build` (content hash of the client bundle, including the sim WASM). If they don't match the server's build, the server answers `error {code: 'BUILD_MISMATCH'}` and the client shows "The host updated the game. Reload". Mismatched builds must never share a session.

---

## 9. Security model

- **Reachability:** the server address is hard-coded to `127.0.0.1`. It cannot be changed through configuration or environment variables.
- **Identity:** clients use nicknames. The server does not trust proxy-provided identity headers.
- **Authentication:** none. The removed public-link access-code feature is not part of this repository.
- **Limits:** max 2 players; max message size 4 MB (`MAX_MESSAGE_BYTES`), except desync-repair `checkpoint` messages (64 MB, §7.4) and world uploads (256 MB, host only); op rate limit 200/s per player (ops, locks and unlocks); chat 5 messages/s.
- **No secrets** are stored by the server. Worlds are plain files in `data/`, which is excluded from version control.

---

## 10. Protocol (WebSocket `/ws`, MessagePack)

All messages are `[type, payload]` arrays, MessagePack-encoded (`msgpackr`). Binary blobs (world snapshots, checkpoints) are MessagePack `bin` fields holding `.knockon` / KNCP containers, whose sections are already deflated (DATA_FORMATS §2, §6); there's no extra zstd layer. Protocol version: `1` (`PROTO`). Unknown types and non-map payloads are rejected (`decodeClient` / `decodeServer`).

### 10.1 Client → server (`ClientMsgs`, `packages/net/src/protocol.ts`)

| Type | Payload | Notes |
|---|---|---|
| `hello` | `{proto, build, tier, resumeToken?, nickname?}` | First message. `tier` ∈ 4 / 8 / 12 / 16 / 32, anything else reads as 4 |
| `join` | `{worldId}` or `{newWorld: {name, preset}}` | Host only for `newWorld` |
| `op` | `{clientOpId, baseSeq, op}` | §5; undo and redo are ops too (§5.5) |
| `lock` / `unlock` | `{ids}` | §5.4 |
| `presence` | `{cam: [x, y, z, qx, qy, qz, qw], cursor?: [x, y, z], tool, ghost?: {type, pos, rot?, parts?}}` | 20 Hz max (the client throttles). `ghost` is what the player holds (a drag, a gizmo move, a paste). D124 appended the optional `rot` (quaternion) and `parts` (≤ 32 held parts, `[type, dx, dy, dz, qx, qy, qz, qw]`: mm offsets from `pos`, quaternion × 10 000), so PROTO is unchanged and older clients read `type` + `pos` |
| `ping` | `{pos, kind}` | `look` / `help` / `nice` / `boom` |
| `chat` | `{text}` | ≤ 280 chars |
| `run.request` | `{solo?: false}` | Starts the countdown |
| `run.cancel` / `run.stop` | `{runId}` | |
| `play` | `{runId, tick, speed, paused}` | Shared playhead change |
| `baked` | `{runId, tick}` | 4 Hz |
| `poke` | `{runId, tick, partId, kind, data}` | §7.3 |
| `hash` | `{runId, tick, h, mc?, pk?}` | Every 60 ticks; `h` includes the Matter checksum, `mc` repeats it (M4); `pk` = pokes it was computed with (M5, §7.3) |
| `checkpoint` | `{runId, tick, blob}` | Authority only, on request; up to 64 MB (§7.4) |
| `save` | `{}` | |
| `time` | `{t0}` | Clock sync probe |

**Not built:** a separate `undo` message, `saveAs` / `export` messages (export is client side), and `worldHash` in `hash`.

### 10.2 Server → client (`ServerMsgs`)

| Type | Payload |
|---|---|
| `welcome` | `{you: PlayerInfo {slot, name, login, color, isHost, tier}, serverBuild, worlds[], resumeToken}` |
| `snapshot` | `{worldId, seq, world: bin, players, locks, run: {runId, worldSeq, phase, startsAt, pokes} \| null}` |
| `op` | `{seq, by, op}` |
| `op.ack` / `op.reject` | `{clientOpId, seq}` / `{clientOpId, reason}` |
| `locks` | `{held: {id: slot}, released: ids[]}` (deltas) |
| `presence` / `ping` / `chat` | Relayed, with `by` (chat also `at`) |
| `peer` | `{event: 'join' / 'leave' / 'reconnect', player}` |
| `run.countdown` | `{runId, startsAt, by}` |
| `run.start` / `run.cancel` / `run.stop` | `{runId, worldSeq}` / `{runId, by}` / `{runId, by}` |
| `play` | `{runId, tick, speed, paused, atServerTime, by}` |
| `bakedMin` | `{runId, tick}` (sent whenever the minimum differs from the last one sent, D108) |
| `poke` | `{runId, tick, seq, by, partId, kind, data}` |
| `desync` | `{runId, tick}` → authority replies with `checkpoint` |
| `checkpoint` | `{runId, tick, blob}` (to the out-of-sync client) |
| `saved` | `{worldId, at}` |
| `time` | `{t0, serverTime}` |
| `error` | `{code, message}`: `BUILD_MISMATCH`, `PROTO_MISMATCH`, `SESSION_FULL`, `NOT_ALLOWED`, `OVER_CAPACITY`, `RATE_LIMIT`, `BAD_MESSAGE`, `NOT_HOST` |

Share links bigger than a URL fragment use plain HTTP routes on the same host (`POST /share/world` and friends, `apps/host/src/share.ts`; DATA_FORMATS §7).

### 10.3 Bandwidth budget

| Stream | Typical |
|---|---|
| Presence (2 players, 20 Hz, ~40 B) | ~1.6 KB/s |
| Build ops (bursty; a brush stroke of 500 tiles ≈ 12 KB) | ~0–5 KB/s |
| Run: playhead, baked, hashes | < 0.5 KB/s |
| Join snapshot | Room ≈ 50–500 KB; Megastructure ≈ 4–8 MB (one time) |
| First load of the game itself | Shell ~2 MB + core part pack ~25 MB, then cached by a service worker. *As built:* no service worker; assets are fetched per part on first use and cached by the browser's HTTP cache. KTX2 texture sets are about 34 % larger than PNG (D97) |
| Desync repair (rare) | A checkpoint, up to 64 MB; 7.7 MB for a 1M-water world (§7.4) |

---

## 11. Persistence (on the host)

```
data/
  worlds/<worldId>/
    world.knockon          latest compacted world (binary, GAME_SPEC §17.1)
    journal.oplog          ops since last compaction (append-only, fsync every 1 s)
    runs/<runId>.inputs    input logs for saved replays
    thumb.webp
    backups/               rotating compacted snapshots (default: last 20, one per 10 min of activity)
  modules/                 shared module library (prefabs)
  desync-reports/
  server.json              ID counters per slot, session settings
```
- *As built (`apps/host/src/storage.ts`, `share.ts`, `config.ts`):* each world folder holds `world.knockon`, `meta.json`, `journal.oplog` and `backups/` (`world-<time>.knockon`, keep 20). Shared blobs live in `data/shares/<id>.knockon|.knockmod` with a JSON sidecar. **Not built:** `runs/`, `thumb.webp`, the shared `modules/` library (modules are stored inside each world, `MODL`), `desync-reports/` and `server.json`.
- **Compaction:** every 2 minutes, or 5,000 ops, or on the last player leaving. The journal is applied to `world.knockon` and truncated.
- **Crash safety:** on start, the server loads `world.knockon` and then replays `journal.oplog`.
- **Export / import:** players can download any world as a `.knockon` file, or upload one (host only) from the lobby.

---

## 12. Stretch goals
- **Spectators** (read-only, unlimited, no presence drone): useful for streaming to more friends.
- **3–4 builders:** the protocol already supports N; UX (colours, lock contention) needs work.

---

## 13. Implementation notes
- `packages/net`: protocol types, MessagePack codec, size caps, clock sync. Shared by client and server. Optimistic ops, rebase and undo live in `packages/docstore` (`DocStore`), and the client's socket and DocStore wiring in `apps/game/src/net.ts`.
- `apps/host`: Node 22 LTS minimum (tested on Node 24), Fastify (static files + headers), `ws`, `msgpackr`. Single process. Storage uses the format's deflate; no zstd dependency.
- Static headers on every response: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Resource-Policy: same-origin`, plus long-cache hashed assets.
- The editor's local single-player mode uses the **same op pipeline** with an in-process "loopback server". That's how multiplayer stays first-class instead of becoming a second code path.
- Tests: a two-headless-client soak test (random ops + runs + pokes for 30 min, simulated latency, and jitter) must end with identical worlds and zero desyncs. `apps/host/soak/soak.ts` (`pnpm soak`) runs a local Host Server and two headless clients, with random edits, runs, late joins and pokes, and fails on any desync or rejected poke. `--ahead` / `--ahead-b <ticks>` make the clients bake ahead of the playhead like the browser does, so pokes land behind already-reported hashes (M5, D108). `apps/host/test/latepoke.test.ts` reproduces the late-poke case against a real host session. `apps/host/soak/critters.ts` is the critter rollback soak.
- *As built:* single player uses a real Host Server on the same machine (`pnpm dev` starts it), not an in-process loopback; the op pipeline is the same.
