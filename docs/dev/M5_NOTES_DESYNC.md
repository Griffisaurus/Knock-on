# M5 notes: the "Player 2 pokes" co-op desync

2026-10-25. Debugging stream for the high-priority bug from the [2026-10-25 playtest](../../playtests/2026-10-25.md): in a two-window co-op session, 4 of 9 runs where Player 2 started the run and clicked THE BUTTON reported desyncs at tick 60, 120, …, 360 (sometimes 420), and P2 re-synced after each one. 0 of 10 runs Player 1 started did.

Status: **fixed** (root cause found, fix in, regression test, repro and soak clean).

## Root cause: stale hash reports, not a divergence

The machines never diverged. The host compared hash reports that had been made **before the poke reached the client** with reports made **after** it.

- The sim worker hashes the state every 60 ticks and reports the hash of tick T once its bake head reaches T + 120 (D59). D59 assumed a poke is never more than 1 s late, so a rollback would rewrite a hash before it was sent.
- The game client doesn't step on the clock. It **bakes up to 480 ticks (4 s) ahead of the playhead** (`BAKE_AHEAD`), but a poke is scheduled only 12–36 ticks ahead of the poker's playhead. So when the poke arrives, the receiving client has usually reported every hash up to bake head − 120 already, all computed without the poke. After the rollback, the worker deleted the old hashes but never sent the re-baked ones (`hashSent` stayed where it was).
- Whether a given tick's report went out with or without the poke depends on **how far that client had baked when the poke reached it**. Two clients whose bake heads straddle a report boundary send different hashes for the same tick, and the host flags a desync. The run itself is identical on both machines.
- **The signature.** At run start the bake heads ramp up from 0 at different speeds. The worker builds the machine, the Jolt threads start, and the CPU and GPU are shared, with the other window and other streams. If a client had baked past tick 180 to 540 when the poke came, it had already reported hashes 60–420 without the poke. A slower partner reports the same ticks with it. Hence "desync at tick 60/120/…/360", one per already-reported tick and none after, exactly as in the playtest's host log.
- **The repeats.** Each desync makes the authority (P1) send a checkpoint, and P2 adopts it. P2 repeats this once per stale tick, although the states were equal: 6–7 re-syncs per run, and "SIM 0.23×" in one run while P2 re-baked.
- In steady state the same race exists at the report horizon. If the two bake heads differ by a few ticks around a T + 120 boundary when a poke arrives, one tick is flagged (my repro: "desync at 420", bake heads 553 vs 537). And the stale reports that both sides made before a poke compared *equal*, so those ticks were never really checked.
- **Why "P2" and the event order.** Which client is ahead at the moment of the poke depends on load, focus and worker start-up, not on the slot. In the playtest and in my two-window repro, the starter's window was the one the script had just typed into. When P2 started, its poke usually landed while the two bake heads were far apart: in the clean repro, 3 of the 5 P2-started runs had reports straddling the poke, against 0 of the 4 P1-started runs with a poke. The different event order in desynced runs (Press/Signal/Call before Teleport/Emerge) only means THE BUTTON was pressed early in those runs: the poke was scheduled at a low tick because the poker's playhead was held at its own slow bake head. That same condition puts the poke behind the partner's reports.
- **Why the orchestrator's checks were clean.** `repro_p2.ts` compared final per-tick hashes, which do match: the sim is fine. The 2-player soak's Node client steps on the clock (bake head ≈ playhead) and its pokes are at most about 40 ticks late, so D59's assumption held there. It never baked ahead.

## Evidence

Repro: `scratchpad/desync/repro.mjs` (a local scratch folder; adapted from U5's `pt.mjs`). It uses its own headless Chrome (CDP :9520), Vite :5320, and a host on :8920 with `KNOCKON_STATIC=none` and a scratch `KNOCKON_DATA` that serves `playtests/2026-10-25-world.knockon`. P1 and P2 are two windows. Each run, the starter presses Space and clicks THE BUTTON 3.4 s later, as `pt.mjs` does. The script hooks `net.send` and `RunController.tell` on both pages and logs every hash each client sent (tick, h, pk), the playhead and bake head when the poke reached each client, and the desync and re-sync counts. To mimic the playtest's busy PC, `burn.mjs` runs 12–20 CPU-bound Node threads beside it (24-core PC, 12 Jolt threads per window).

**Before the fix** (two clients in one window as tabs, 20 burner threads, P2 starts and pokes): **3 of the 9 runs with a poke desynced** (in the first run the click came before the worker was ready). The host log is the playtest's:

```
run 8 (P2): desyncs 6, resyncs 5 · poke tick 77 · P1 got it at bake 542 · P2 at bake 175 · first-report diffs at [120,180,240,300,360,420]
run 9 (P2): desyncs 4, resyncs 4 · poke tick 41 · P1 got it at bake 520 · P2 at bake 293 · first-report diffs at [180,240,300,360]
run 10 (P2): desyncs 5, resyncs 5 · poke tick 61 · P1 got it at bake 539 · P2 at bake 238 · first-report diffs at [180,240,300,360,420]
host: desync at tick 180 … 420: Matter checksums agree (0000000000000000 / 0000000000000000)
```

P1 was 4 s ahead and had reported ticks up to 420 without the poke. P2 was still ramping up and reported them with it. Every tick the host flagged lies between P2's bake head − 120 and P1's bake head − 120 at the moment of the poke. No later tick differs: the runs agree once the stale reports are used up. Without load, the same race showed at the report horizon: 1 of 4 runs had "desync at 420" with bake heads 553 vs 537.

## The fix

Every hash report now says which pokes it was computed with. A client reports again whatever it re-baked. The host compares only like with like.

| File | Change |
|---|---|
| `packages/net/src/hashes.ts` (new) | `HashReporter`, the client's hash bookkeeping. It records a hash with `pk`, the number of known pokes with tick < T (a poke at tick p is applied in the step p → p + 1). `rewind(tick)` after a rollback or re-sync drops the newer hashes and moves the report cursor back, so the re-baked ticks are reported again. `take(bakeHead)` returns the reports that are due (D59's 120-tick lag is kept). `comparable(pks)` is the host's rule: compare only reports with equal `pk`; reports without `pk` (older clients) compare as before. Pokes reach both clients in the same server order, so equal `pk` means the same inputs. |
| `packages/net/src/protocol.ts`, `index.ts` | `hash` gains an optional `pk`. The change is additive, so `PROTO` is unchanged. |
| `apps/game/src/sim.worker.ts` | Uses `HashReporter`. `poke` (and early pokes after a rejoin) are counted. `truncate()`, used by both the poke rollback and `importCheckpoint`, calls `rewind`. The hash message carries `pk`. |
| `apps/game/src/run.ts` | Forwards `pk` to the host. |
| `apps/host/src/session.ts` | `onHash` stores `{h, pk}` per slot. A tick is compared once every player has reported it **with the same `pk`**. Until then it waits: the client that missed the poke sends its re-baked report after rolling back, and that report replaces the stale one. The 64-tick pruning is unchanged. |
| `apps/host/soak/soak.ts` | The soak client now uses the same `HashReporter` (with `pk`, and re-reports after rollbacks and re-syncs). New `--ahead <ticks>` / `--ahead-b <ticks>` bake ahead of the playhead the way the game does, with pokes scheduled from the playhead. The default of 0 keeps the old clock stepping. |

The fix also means the ticks right after a poke are now really compared: both clients re-report them with the poke included. Before, both sides' stale reports matched and nothing was checked for those ticks.

A real divergence is still caught: same `pk` with a different hash is a desync, as before. If a client can't roll back (a poke older than the rollback window), its later hashes carry the poke's `pk` but not its effect, so they differ and are flagged. If a client never re-reports a held tick (it froze or left), the tick is pruned like any unmatched tick; later ticks are still compared.

## Regression test

`apps/host/test/latepoke.test.ts` is a Node-level reproduction of the client path. Two clients each run a real `Machine` and follow the sim worker's hash path: bake ahead, hash every 60 ticks, report 120 ticks behind the bake head, and on a poke behind the bake head `addPoke` → `restore` → `rewind` → re-bake. They play against a **real host session** over WebSockets. The playtest scenario: P1 has baked to 480 and reported ticks 60–360 when the poke arrives; P2 has baked to 150 and pokes tick 40.

- With the fix: no desyncs.
- `legacy` mode (no `pk`, no re-reports: the code before the fix): the host flags **exactly `[60, 120, 180, 240, 300, 360]`**, the playtest's signature.
- A real divergence (P2 applies the poke with different data) is still flagged at tick 60 and after.
- Host unit checks: a tick with different `pk` is held and then compared after the re-report; reports without `pk` compare as before. `HashReporter` and `comparable` unit tests are in the same file.

## Results

**Repro after the fix:** P2 pokes in every run unless noted. Each line is a fresh Chrome. "Straddled" counts runs where the two clients' first reports of some tick were made with different pokes; each of those would have been a desync before the fix.

| Setup | Runs | Desyncs | Straddled (old code: desync) | Last reports differ |
|---|---|---|---|---|
| tabs, 20 burner threads | 12 | **0** | 2 (ticks 60–420; P1 re-sent 7) | 0, except one run where P1's background tab froze (below) |
| tabs, 12 burner threads | 12 | **0** | 1 | 0, same caveat |
| two windows, 12 burner threads | 12 | **0** | 6 | 0 |
| two windows, no load, alternating starters | 10 (5 P2) | **0** | 3 (all in P2-started runs) | 0 |

The first run of each fresh Chrome had no poke: the poker's worker was still loading Jolt when the click came, so `run.poke` was ignored. That leaves **38 runs with a P2 poke and 0 desyncs** (plus 4 with a P1 poke), against 3 of 9 before under the same load. There were no page exceptions.

**Soak:**
- `node apps/host/soak/soak.ts --minutes 5 --run 30 --starter alt`: **PASS**: 10 runs, 108 pokes, 41/41 rollbacks, 580/580 hashes, 0 desyncs, 0 resyncs, 0 errors.
- New game-like mode, `--minutes 5 --run 30 --starter alt --ahead 480 --ahead-b 120`: both clients bake ahead, B less, so most pokes land behind already-reported hashes. **PASS**: 10 runs, 103 pokes, 102/102 rollbacks, 1261/613 hashes (A re-reports after its rollbacks), 0 desyncs, 0 resyncs, 0 errors. This mode recreates the playtest's conditions (I didn't run it on the old code; the regression test's `legacy` case shows the failure deterministically).

`pnpm -s typecheck`, `pnpm -s lint` and `vitest run packages/net apps/host apps/game` pass (20 files, 188 tests). `apps/host/soak/_tmp/` (the orchestrator's `repro_p2.ts`) is deleted.

## Observations (not fixed here)

- **Background-tab starvation.** With both players as tabs of one window, the hidden tab's renderer gets so little CPU under load that its worker sometimes didn't start for 10 s or more, or froze for over 8 s after a rollback. That explains the "last reports differ" rows: P1 simply stopped reporting, so the run was not divergent. With two windows (the playtest's setup) it never happened. Under heavy load the threaded Jolt loader also fell back to single-threaded in that tab ("threads 0").
- **A partner who never bakes doesn't hold playback.** While one client's worker hasn't reported `baked` yet, the host's `bakedMin` stays 0 and is only broadcast on change. The other client therefore plays with `bakedMin = Infinity`, up to 1000+ ticks ahead of a partner stuck at 0. Worth a look by the net owner: broadcast the initial `bakedMin`, or count a not-yet-ready player as 0.
- Clock offsets in the repro put the two playheads up to 25 ticks apart at the same instant (P1 at 24.6 while P2 was at 51.3). That is within the input delay, but it widens the start-of-run spread.
- **D59 in DECISIONS_2026-10-24.md** describes the old assumption ("a late poke never looks like a desync"). MULTIPLAYER §7.3/§7.4 and ARCHITECTURE §5 are updated. The orchestrator may want a decision entry that amends D59 with the `pk` rule.
