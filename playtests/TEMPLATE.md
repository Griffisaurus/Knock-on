# Playtest YYYY-MM-DD: <theme>

<!--
How playtests work (PRODUCTION §6). Copy this file to playtests/YYYY-MM-DD.md (add -b, -c … for a second session that
day) and fill it in during and right after the session. Measure, don't estimate: every number below comes from a clock,
a counter or the perf readout (F9), not memory.

- Weekly internal: a 30-minute themed build ("make Mochi push a Bangstick off a ledge"), timed and recorded.
- Bi-weekly local co-op with two browser clients, following LOCAL_DEVELOPMENT.md word for word so the setup docs are tested too.
- No telemetry: someone watches and writes things down (or a script logs them, for an automated session).
- Label the session honestly: "internal (devs)", "external testers" or "automated (scripted self-test, no human players)".
-->

| | |
|---|---|
| **Kind** | internal (devs) · external testers · automated (scripted self-test) |
| **Players** | who (or which script), solo or co-op; who hosted |
| **Build** | Settings › About › Build, and the host build |
| **Setup** | local browser and version, GPU and tier, Physics threads, Reduce transparency, colour preset |
| **World** | size, environment, gravity / air, Matter on or off |
| **Theme** | the challenge, in one line |
| **Session length** | planned 30 min; actual hh:mm |
| **Recording** | where the clip or screen recording is, if any |

## Timeline

| Time (mm:ss) | What happened |
|---|---|
| 00:00 | session start |
| | first part placed |
| | first run |
| | **first working chain** (≥ 2 knock-on steps, K.O. ≥ 2) |
| | theme achieved |
| 30:00 | session end |

## Metrics (PRODUCTION §6)

| Metric | Value | How measured |
|---|---|---|
| Time to first chain | mm:ss | timeline above |
| Undos per minute | n / min (n undos in m min) | count Ctrl+Z and the undo button |
| Library: searches vs browsing | n searches · n tab or scroll picks | count |
| "What does this part do?" questions | n (list the parts) | note each one |
| Runs | n (n with a working chain) | count LET IT RIP |
| Desyncs / re-syncs | n / n | Settings › About › Export diagnostics (`run.desyncs`, `run.resyncs`), or the toasts |
| Frame time | median and worst ms | F9 readout during the biggest run |
| Sim dilation | lowest SIM ×, and whether Bake & Watch was used | the run bar's SIM badge |
| Errors | toasts, console errors, crashes | |

## Notes

### What worked

### Where players got stuck

(Each with the time, what they tried, and what would have helped.)

### Bugs found

| What | Steps | Severity | Filed for (stream / doc) |
|---|---|---|---|

### Doc checks

Did HOW_TO_PLAY (and, for co-op, LOCAL_DEVELOPMENT) say the right thing at each step? List every place the docs were wrong or missing.

## Follow-ups

| Action | Owner |
|---|---|
