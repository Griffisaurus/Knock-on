// KNOCK-ON client: connect to the Host Server, build together, wire things up, let it rip.

import './styles.css';
import { metresToPos, posToMetres, snappedEuler, type LinkKind, type LinkRecord, type PartRecord, type Rotation } from '@knockon/format';
import type { ServerMsgs } from '@knockon/net';
import { coveProfile, KITCHEN, LINK_FOR_CHANNEL, PRESETS, propSteps, propValues, studioCove, type PartDef, type PortDef, type PresetId } from '@knockon/parts-data';
import { PartFlagBits, roundPath, rotationToQuat, type SimEvent } from '@knockon/sim';
import { probe } from './caps.ts';
import { CHANNEL_GLYPH, CHANNEL_HEX, CHANNEL_RGB, DANGER_RGB, FAMILY_HEX, hexLin, PALETTE, PLAYER_RGB, partDef, qinv, qrot, type Q4 } from './catalog.ts';
import { Fx } from './gfx/fx.ts';
import { FUTURE_TYPES, FutureFx, type FuturePart } from './gfx/future/index.ts'; // R5 (M5)
import { WetnessMask } from './gfx/wetness.ts'; // R5 (M5)
import { ARTICULATED, fingerOffset, gripOf } from './gfx/resize.ts'; // R5 (M5): GRABBER's turret and fingers
import { ContainerFills, CONTAINER_TYPES, MatterRenderer, setMatterSource } from './gfx/matter/index.ts'; // R4 (M4): Matter surfaces + fill pass
import { loadPartMesh } from './gfx/glbmesh.ts';
import { ART_PARTS } from './artlist.ts';
import { InstanceData, Renderer, STUDIO_DARK, STUDIO_LIGHT, type SceneItem } from './gfx/renderer.ts';
import { invert, transform, type V3 } from './math.ts';
import { NetClient } from './net.ts';
import { RunController } from './run.ts';
import { CaptureController } from './capture/index.ts'; // C4 (M4): photo mode, offline clips, share card
import { RunBar } from './ui/runbar.ts';
import { AUDIO_PROP_TYPES, GameAudio, ROLLERS, type MatterViewLike } from './audio/index.ts'; // AUDIO (beta, D127): AUDIO_PROP_TYPES
import { matterView } from './matterhost.ts'; // audio (M4): Matter sound reads a GPU reduction of the particles (F4)
import { coveMesh, sweptTube } from './gfx/meshes.ts';
import { Library, Palette, Radial, type Command } from './ui/panels.ts';
// M2 stream D: outliner, layers, modules, section box, X-ray/cutaway, settings, Cascade Report
import { BuildTools } from './ui/buildtools.ts';
// M3 stream U3: Glass Lab HUD (world card, session bar, view rail, Inspector, transport, parts tray, lobby)
import { buildHud } from './ui/hud.ts';
import { terrainHit } from './ui/terrainpick.ts'; // U3: the cursor lands on the Backlot terrain
import { joltThreadsSetting, onSettingsChange, remapKey, settings } from './ui/settings.ts';
import { KeyboardBuild, type PortInfo } from './ui/keyboard.ts'; // U4 (M4): keyboard building aids
// DRAG (D117): drag-to-move, the shared blocked test and grid snap, and the transform gizmo
import { BadgeOverride, DragMove, modsOf, overlapOf, partBox, snap, surfaceY, worldBox, type MoveHost, type MoveSession } from './ui/dragmove.ts';
import { GizmoTool } from './ui/gizmo.ts';
// BUILDUX (D123–D124): box select, copy / paste / duplicate, mirror, port snapping, the turned partner ghost
import { BoxSelect, type MarqueeItem } from './ui/boxselect.ts';
import { ClipTool, ghostLinkDraws } from './ui/clipboard.ts';
import { AXIS_NAME, mirrorSelection, type Axis } from './ui/mirror.ts';
import { altDown, invalidatePortIndex, portSnapItems, portSnapOn, snapPlacement, snapSession, type SnapInfo } from './ui/portsnap.ts';
import { decodeGhost, encodeGhost } from './ui/presenceghost.ts';
import { moveRefusal } from './ui/dragmove.ts';
import { setSetting } from './ui/settings.ts';
import { lockedReason, partVisible } from './ui/organise.ts';
import { announce } from './ui/a11y.ts';
// M2 stream C: cameras, skinned critters, environments (MEGA KITCHEN)
import { CameraRig } from './cameras.ts';
import { CritterView } from './gfx/critters.ts';
import { EnvView } from './gfx/environment.ts';
import { GutterView } from './gfx/gutter.ts';
import { TerrainView } from './gfx/terrain.ts'; // S3: Backlot terrain (wired by U3)
import { GlidepathView } from './gfx/glidepath.ts';
import { PartMorphs } from './gfx/partmorph.ts';
import { boundsOf, compose, fillBuildScene, fillRunScene, linkItems, partItems, partPose, POOL_PARTS, portItems, portWorld, type LinkDraw, type Pose, type PoseOf } from './scene.ts';

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

type Tool = 'place' | 'select' | 'wire' | 'path';
interface Hit { point: V3; part: PartRecord | null; normal: V3 }
interface PortRef { part: PartRecord; def: PartDef; port: PortDef; index: number; world: V3 }

/** Start screens (beta): the loading screen's message while boot runs, and the title screen's state. */
let titleUp = false;
function startStatus(msg: string): void {
  const el = document.querySelector('#splash .ss-msg');
  if (el) el.textContent = msg;
}
function hideSplash(): void { document.getElementById('splash')?.classList.add('done'); }
/** Title screen: Play now runs `onPlay` (joins the session, starts building); the viewport is inert until then. */
function showTitle(onPlay: () => void): void {
  hideSplash();
  const title = document.getElementById('title');
  const btn = document.querySelector<HTMLButtonElement>('#title .ti-play');
  if (!title || !btn) { onPlay(); return; }
  title.hidden = false;
  titleUp = true;
  const viewport = document.getElementById('viewport');
  if (viewport) viewport.inert = true;
  btn.focus();
  btn.onclick = () => {
    titleUp = false;
    if (viewport) viewport.inert = false;
    title.classList.add('done');
    setTimeout(() => title.remove(), 400);
    onPlay();
  };
}

async function boot(): Promise<void> {
  startStatus('Checking your graphics card…');
  const caps = await probe();
  if (!caps.webgpu || !caps.secureContext) {
    showBlocker('WebGPU is not available',
      caps.secureContext
        ? 'Your browser or GPU does not expose WebGPU. KNOCK-ON targets desktop Chrome. Open /check for details.'
        : 'This page is not a secure context. Open the local development server at http://localhost:8787.');
    return;
  }

  // Settings › Graphics › Quality tier overrides the detected tier (M3 close-out: it used to reach only the glass
  // UI, so choosing 32 GB never changed the renderer). Chromium hides the adapter name, so on an RTX 5090 the
  // detected tier is a guess and this choice is how the 32 GB tier (D85) is reached. It applies at boot.
  if (settings.graphics.tier !== 'auto') caps.tier = settings.graphics.tier;
  const canvas = $<HTMLCanvasElement>('#viewport canvas');
  startStatus('Starting the renderer…');
  const renderer = new Renderer(canvas, { tier: caps.tier });
  await renderer.init();
  const fx = new Fx(renderer, caps.tier);
  const future = new FutureFx(renderer, fx, caps.tier); // R5 (M5): the vfx.md §7 Future Tech effects
  const wetness = new WetnessMask(renderer); // R5 (M5): wet surfaces where Matter water is or was (the Kitchen basin)
  // R4 (M4): Matter surfaces draw MI's playback view (matterhost.ts `matterView()`, MX's buffers on this device)
  const matter = new MatterRenderer(renderer, caps.tier);
  setMatterSource({ view: () => matterView() });
  matter.onImpacts = (pts) => { for (const p of pts) fx.sandPuff(p, 0.6); }; // vfx §3.3: fast sand landing (GPU samples)
  const containerFills = new ContainerFills();
  let containerParts: { id: number; type: string; props: Record<string, number> }[] = [];
  // G3 (M3): debug / benchmark switches: ?gi=sdf|gi (GI debug view), ?taa=0.67 (upscale scale, 1 = native;
  // otherwise Settings › Graphics › Render scale below 100 % upscales with TAA), ?probes=0, ?vol=0
  const taaUrl = new URLSearchParams(location.search).has('taa');
  const NO_BEAMS = new Float32Array(0);
  {
    const q = new URLSearchParams(location.search);
    const g = q.get('gi');
    if (g === 'sdf' || g === 'gi') renderer.gi.debug = g;
    if (q.has('taa')) renderer.upscale = Number(q.get('taa')) || 0;
    if (q.get('probes') === '0') renderer.gi.probesOn = false;
    if (q.get('vol') === '0') fx.volumetrics = false;
  }
  // Final art from the pipeline replaces blockout primitives part by part (ASSET_PIPELINE §11)
  const artMeshes = new Set<string>();
  const critters = new CritterView(renderer); // stream C: GPU-skinned critters (contract 3)
  const envView = new EnvView(renderer); // stream C: MEGA KITCHEN replaces the Studio when doc.env says so
  const gutters = new GutterView(renderer); // stream C: GUTTER links
  const terrainView = new TerrainView(renderer); // S3: the Backlot's heightfield (set each frame from the doc; U3 wiring)
  const glidepaths = new GlidepathView(renderer); // G3: GLIDEPATH links
  const partMorphs = new PartMorphs(); // stream C: SPRONG, PUFFER, CORK BLASTER, GOTCHA BOX, BIG TOP, PUNCHLINE shape keys
  if (new URLSearchParams(location.search).has('skintest')) critters.enableTest(Number(new URLSearchParams(location.search).get('skintest')) || 8);
  startStatus('Loading parts and environments…');
  await Promise.all([
    critters.load(), // /parts/<critter>/<critter>.glb when stream E has built it

    ...ART_PARTS.map(async (t) => { if (await loadPartMesh(renderer, t)) artMeshes.add(t); }),
    renderer.loadDecalAtlas('/kit/decals_atlas.png'), // kn_decal texels stay transparent without it
  ]);
  // multi-body parts export their moving piece as `<type>:arm` (glbmesh.ts)
  const artMesh = (t: string): number | null => (renderer.lib.has(t) && (artMeshes.has(t) || artMeshes.has(t.split(':')[0]!)) ? renderer.lib.id(t) : null);

  startStatus('Building the workshop…');
  const nickname = localStorage.getItem('kn.nick') ?? '';
  const net = new NetClient(caps.tier, nickname);
  const ui = buildHud(net); // stream U3 (ui/hud.ts)
  const run = new RunController(net, ui.toast);
  run.joltThreads = joltThreadsSetting(); // U5 (M5): Settings › Performance › Physics threads, read at boot (D99)
  run.attachMatter(renderer.device, caps.tier, (cb) => renderer.onRestore((r) => cb(r.device))); // MI (M4): Matter shares the renderer's device (D92), and follows it after a device loss (V4)
  // G3: hitstop / auto slow-mo, the test system only; the audio sags and swells with it (F3)
  fx.onTimeWarp = (factor, seconds, kind) => {
    run.warp(factor, seconds);
    if (kind === 'hitstop') audio.hitstop(seconds * 1000, 1);
    else audio.slowmo(factor, seconds);
  };
  ui.onRip(() => run.primary());

  // ---- audio (AUDIO.md): procedural, unlocked by the first gesture ----------------------------------
  const audio = new GameAudio();
  // volumes come from the per-viewer settings (ui/settings.ts, stream D)
  audio.setVolumes(settings.audio);
  onSettingsChange((s, path) => { if (path.startsWith('audio') || path === '*') audio.setVolumes(s.audio); });
  // audio (M4): granular sand / water / marbles around the listener, probed (≤ 30 Hz) from MI's Matter view; null = no Matter
  audio.setMatterView(() => matterView() as MatterViewLike | null); // MX backend.ts MatterView (pos / vel / mat on the shared device)
  // the renderer, effects and VRAM budget are sized for the tier at boot: a new tier takes a reload
  onSettingsChange((s, path) => {
    if (path !== 'graphics.tier') return;
    const want = s.graphics.tier === 'auto' ? null : s.graphics.tier;
    if (want !== caps.tier) ui.toast(`Quality tier: reload the page to switch to ${want === null ? 'the detected tier' : `${want} GB`}.`);
  });
  // U5 (M5): physics threads also apply at the next page load (a threaded Jolt module keeps its heap and workers)
  onSettingsChange((_s, path) => {
    if (path !== 'performance.joltThreads') return;
    const want = joltThreadsSetting();
    if (want !== run.joltThreads) ui.toast(`Physics threads: reload the page to switch to ${want === undefined ? 'Auto' : want === 0 ? 'single-threaded' : `${want} threads`}.`);
  });
  const unlock = (): void => { void audio.unlock(); };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  const partTypeOf = (id: number): string | undefined => net.store?.doc.parts.get(id)?.type;
  run.onEvents((events) => audio.onSimEvents(events, partTypeOf));
  let audioMochiDirty = true, audioMochiAt = 0; // audio (M3)
  net.on((e) => {
    if (e.type === 'chat') audio.ui('chat');
    if (e.type === 'toast' && e.level === 'warn') audio.ui('error');
    if (e.type === 'doc') audioMochiDirty = true; // audio (M3): the Tinker Lab's ambient MOCHI hides while a MOCHI part exists
  });
  // audio (M3): re-checked at most every 2 s after an edit, so a big world's part scan stays rare
  const audioMochiCheck = (now: number): void => {
    if (!audioMochiDirty || now - audioMochiAt < 2000 || !net.store) return;
    audioMochiDirty = false; audioMochiAt = now;
    let mochi = false;
    for (const p of net.store.doc.parts.values()) if (p.type === 'mochi') { mochi = true; break; }
    audio.setAmbientMochi(!mochi);
  };

  // THE STUDIO cyclorama (environments.md §1.1): a swept cove around the preset's bounds
  let coveFor = '';
  let coveMeshId = -1;
  const coveItem = (): SceneItem | null => {
    const preset = net.store?.doc.env.preset ?? 'room';
    if (preset !== coveFor) {
      coveFor = preset;
      const c = studioCove(preset);
      coveMeshId = c ? renderer.addMesh(`cove:${preset}`, [coveMesh(c, coveProfile(c.radius, 12))]) : -1;
    }
    if (coveMeshId < 0) return null;
    const L = renderer.look;
    return { pos: [0, 0, 0], size: [1, 1, 1], mesh: coveMeshId, color: [L.cyc[0] * 0.92, L.cyc[1] * 0.92, L.cyc[2] * 0.92], rough: 0.72 };
  };
  if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __kn: unknown }).__kn = { run, net, renderer, fx, matter /* R4 */, debug: () => ({ trails, trailRec, workY }) };

  // ---- camera (orbit), with trauma shake for big booms --------------------------------------------
  // Studio default framing (environments brief §1.2): straight front, 30° elevation
  const cam = { yaw: 0, pitch: 0.52, dist: 3.2, target: [0, 0.2, 0] as V3, trauma: 0 };
  const eyeOf = (): V3 => [
    cam.target[0] + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw),
    cam.target[1] + cam.dist * Math.sin(cam.pitch),
    cam.target[2] + cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw),
  ];
  // cameras.ts (stream C): orbit (this `cam`) / director / ride / overview; C cycles, F frames the selection
  const camRig = new CameraRig(cam, {
    run, parts: () => net.store?.doc.parts.values() ?? [], poseOf: (p) => runPose(p),
    selected: () => (selectedId !== null ? [selectedId] : []), hover: () => hover?.point ?? null,
  });
  const knDebug = (window as unknown as { __kn?: Record<string, unknown> }).__kn;
  if (knDebug) Object.assign(knDebug, { camRig, critters, envView });

  // ---- editor state --------------------------------------------------------------------------------
  let tool: Tool = 'place';
  let selectedType = PALETTE[0]!.type;
  let ghostRot = { yaw: 0, pitch: 0, roll: 0 };
  let hover: Hit | null = null;
  let hoverPort: PortRef | null = null;
  let wireFrom: PortRef | null = null;
  let selectedId: number | null = null;
  let drag: { button: number; x: number; y: number } | null = null;
  const pointer = { x: 0, y: 0, inside: false };
  // path tool (TUBE runs) and wire waypoints, on the work plane (HOW_TO_PLAY §3.2, §3.4)
  let pathPts: V3[] = [];
  let pathKind: 'tube' | 'tube_slim' = 'tube';
  let wirePts: V3[] = [];
  let workY = 0;
  const pings: { pos: V3; by: number; until: number }[] = [];
  // ghost trails: where things went during the last run (shown after Stop until the next edit)
  let trails: V3[][] = [];
  let perfHud = false;
  let heldLock: number | null = null;
  let lockAt = 0; // F9 (ARCHITECTURE §10): frame and sim timings
  const trailRec = new Map<number, V3[]>();
  let trailTick = -1;
  const viewport = $('#viewport');
  const runBar = new RunBar(viewport, run, (id) => { const p = net.store?.doc.parts.get(id); return p ? partDef(p.type)?.name ?? p.type : 'PART'; });
  const library = new Library(viewport);
  const palette = new Palette(viewport);
  const radial = new Radial(viewport);
  // M2 stream D: organisation, modules, section box, view toggles, settings, Cascade Report (ui/buildtools.ts)
  const tools = new BuildTools({
    net, renderer, run, viewport, canvas, library, toast: ui.toast,
    selected: () => selectedId,
    setSelected: (id) => { if (id !== null && tool !== 'select') setTool('select'); selectedId = id; ui.inspect(id !== null ? net.store?.doc.parts.get(id) ?? null : null); },
    hover: () => hover, instancesOf: () => instancesOf, markDirty: () => { sceneDirty = true; },
    workY: () => workY, camDist: () => cam.dist, lookAt: (p) => { cam.target = [...p] as V3; }, artMesh,
    useSelectTool: () => setTool('select'),
  });

  // DRAG (D117): drag-to-move (ui/dragmove.ts) and the transform gizmo (ui/gizmo.ts) share one host and one preview
  let lastEye: V3 = [0, 1, 3];
  const moveHost: MoveHost = {
    doc: () => net.store?.doc ?? null,
    phase: () => run.phase,
    selection: () => (tools.selection.size ? tools.selection.ids() : selectedId !== null ? [selectedId] : []),
    selectOnly: (id) => tools.clickSelect(id, { shiftKey: false, ctrlKey: false, metaKey: false }),
    lockedReason: (p) => { const d = net.store?.doc; return d ? lockedReason(d, p) : null; },
    heldBy: (id) => { const s = net.locks.get(id); return s !== undefined && s !== net.me?.slot ? net.players.find((x) => x.slot === s)?.name ?? 'Your partner' : null; },
    world: () => {
      const pr = PRESETS[(net.store?.doc.env.preset ?? 'room') as PresetId];
      return pr ? { min: [...pr.bounds.min] as V3, max: [...pr.bounds.max] as V3, label: `${pr.name} (${pr.size[0]} × ${pr.size[2]} m)` } : null;
    },
    floor: () => (net.store?.doc.activeTerrain() ? null : 0),
    submit: (op) => net.submit(op),
    toast: (t, l) => ui.toast(t, l),
    announce: (t, l) => announce(t, l),
    sound: (k) => audio.ui(k),
    lock: (ids) => { if (ids.length && net.me) net.send(['lock', { ids: [...ids] }]); },
    // the selected part stays held (main's soft lock below); the rest of the gesture's parts are released
    unlock: (ids) => { const rel = ids.filter((id) => id !== selectedId); if (rel.length && net.me) net.send(['unlock', { ids: rel }]); },
  };
  const mover = new DragMove({
    ...moveHost, hit: () => hover, ray: () => ray(), partTop, workY: () => workY, setWorkY: (y) => { workY = y; },
    snap: (s, xf, m) => { const d = net.store?.doc; if (d) snapSession(s, xf, d, m.alt, (p) => tools.pickable(p)); }, // BUILDUX (D124): port snapping
  });
  const gizmo = new GizmoTool({
    ...moveHost, canvas, viewProj: () => renderer.viewProj, eye: () => lastEye, tool: () => tool, primary: () => selectedId, pointer: () => pointer, overPart: () => !!hover?.part,
    busy: () => mover.holding || tools.section.editing || tools.zoneTool.editing !== null || !!tools.grab.editing || tools.volume.dragging,
    addMesh: (name, g) => renderer.addMesh(name, [g]),
  });
  const moving = (): MoveSession | null => mover.session ?? gizmo.session;
  const toolBadge = new BadgeOverride(document.querySelector<HTMLElement>('#toolbadge'));
  // BUILDUX (D123): box select (Select tool, left-drag on empty space) and copy / paste / duplicate (paste = a carried ghost)
  const boxSel = new BoxSelect({
    viewport, canvas, project: (p) => { const c = transform(renderer.viewProj, p); return c[3] <= 0 ? null : [((c[0] / c[3]) * 0.5 + 0.5) * canvas.clientWidth, (1 - ((c[1] / c[3]) * 0.5 + 0.5)) * canvas.clientHeight]; },
    items: () => {
      const d = net.store?.doc, out: MarqueeItem[] = [];
      if (!d) return out;
      for (const p of d.parts.values()) { if (!tools.pickable(p)) continue; const b = partBox(p); if (b) out.push({ id: p.id, pts: [[(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]] }); }
      for (const l of d.links.values()) if (!l.from && !l.to && l.points.length >= 2) out.push({ id: l.id, pts: l.points.map((q) => q.map(posToMetres) as V3) });
      return out;
    },
    selected: () => tools.selection.ids(),
    apply: (ids) => { const d = net.store?.doc; if (!ids.length) tools.selection.clear(); else tools.selection.replace(ids, undefined, (id) => !!d?.parts.has(id)); },
    isPart: (id) => !!net.store?.doc.parts.has(id),
    announce: (t) => announce(t), toast: (t) => ui.toast(t),
    colour: () => (net.me?.slot === 2 ? '#FF3DAE' : '#2FD6FF'),
  });
  const clipTool = new ClipTool({
    doc: () => net.store?.doc ?? null, phase: () => run.phase, worldId: () => net.worldId ?? '', selection: () => moveHost.selection(),
    select: (ids) => { const d = net.store?.doc; if (tool !== 'select') setTool('select'); tools.selection.replace(ids, undefined, (id) => !!d?.parts.has(id)); },
    nextId: () => net.nextId(), submit: (op) => net.submit(op), layer: () => tools.newPartFields().layer ?? 0,
    refusal: (t, n) => tools.placementRefusal(t, n), world: () => moveHost.world(),
    toast: (t, l) => ui.toast(t, l), announce: (t, l) => announce(t, l), sound: (k) => audio.ui(k), mover,
  });
  let placeSnap: SnapInfo | null = null; // BUILDUX (D124): the placement ghost's port snap (glow)
  if (knDebug) Object.assign(knDebug, { mover, gizmo, boxSel, clipTool });

  const setTool = (t: Tool): void => {
    if (t !== tool) { mover.cancel(true); gizmo.cancel(true); boxSel.cancel(); } // DRAG (D117): a tool change drops the gesture (BUILDUX: and a marquee)
    tool = t;
    wireFrom = null;
    wirePts = [];
    pathPts = [];
    if (t !== 'select') { selectedId = null; ui.inspect(null); }
    ui.setTool(t, selectedType);
  };
  const choosePart = (type: string): void => { selectedType = type; setTool('place'); };
  ui.onPick(choosePart);
  library.onPick = choosePart;
  ui.onTool(setTool);
  ui.setTool(tool, selectedType);
  // stream U3: hand the HUD the controllers it drives (tray, view rail, transport, palette extras, run HUD)
  ui.attach({
    run, tools, library, palette, radial, runBar, camRig, cam, canvas, renderer,
    choosePart: (t) => choosePart(t), setTool: (t) => setTool(t), tool: () => tool, selectedType: () => selectedType,
    hoverPart: () => hover?.part ?? null,
    holdsPointer: () => mover.holding || gizmo.holding || boxSel.holding, // DRAG (D117); BUILDUX (D123): a marquee
    gizmoLabels: () => (capture.clean ? [] : gizmo.labels()),
  });
  // C4 (M4): photo mode (F10), the capture dialog (Shift+F10, Cascade Report › Record clip) and the share card. An
  // offline render drives frame() itself (frame-index clock, capture/offline.ts); main asks it for the camera each frame.
  let captureWorldTitle = '';
  net.on((e) => { if (e.type === 'world') captureWorldTitle = e.title; });
  const capture = new CaptureController({
    renderer, run, camRig, canvas, viewport,
    renderFrame: () => frame(true),
    clearSpectacle: () => fx.clear(),
    mute: (on) => audio.setVolumes(on ? { muted: true } : settings.audio),
    toast: ui.toast,
    startSoloRun: () => { if (run.phase !== 'build') return false; run.soloPreview(); return run.solo; },
    stopRun: () => run.stop(),
    worldId: () => net.worldId,
    worldTitle: () => captureWorldTitle,
    clipAudio: () => audio.clip(), // audio (M5): MP4 clips get the game's sound, rendered offline on the frame clock (F5)
  }, {
    partName: (id) => { const p = net.store?.doc.parts.get(id); return p ? partDef(p.type)?.name ?? p.type : 'PART'; },
    runLabel: () => (tools as unknown as { runCount?: number }).runCount ? `run ${(tools as unknown as { runCount: number }).runCount}` : '',
    report: () => tools.cascade.report,
  });
  tools.cascade.onShare = (r) => void capture.shareCard(r);
  tools.cascade.onClip = () => capture.openDialog();
  if (knDebug) Object.assign(knDebug, { capture });
  // U4 (M4): keyboard building aids (GAME_SPEC §20, UI_UX §7): a keyboard cursor that steers `pointer`, so the
  // ghost, snapping and port glows work as with the mouse; Enter places / picks up / wires; [ ] cycle ports in
  // the Wire tool; Shift+arrows orbit; Q opens a sticky radial. ui/keyboard.ts.
  const kb = new KeyboardBuild({
    canvas, pointer, cam, radial,
    viewProj: () => renderer.viewProj, phase: () => run.phase, tool: () => tool,
    hoverLabel: () => {
      if (tool === 'wire') return hoverPort ? `${hoverPort.def.name}, ${hoverPort.port.name} port (${hoverPort.port.channel} ${hoverPort.port.dir})` : 'No port here';
      if (tool === 'place' && hover) { const g = ghostPose(false); const b = g ? blockedBy(partDef(selectedType)!, g) : null; if (b) return `Blocked: overlaps ${partDef(b.type)?.name ?? b.type}`; }
      return hover?.part ? `Over ${partDef(hover.part.type)?.name ?? hover.part.type}` : hover ? (workY > 0 ? `Work plane ${workY.toFixed(1)} m` : 'Over the floor') : '';
    },
    workY: () => workY, setWorkY: (y) => { workY = y; },
    selection: () => {
      const doc = net.store?.doc;
      const ids = tools.selection.size ? tools.selection.ids() : selectedId !== null ? [selectedId] : [];
      return doc ? ids.filter((id) => doc.parts.has(id)) : [];
    },
    partPos: (id) => { const p = net.store?.doc.parts.get(id); return p ? [posToMetres(p.pos[0]), posToMetres(p.pos[1]), posToMetres(p.pos[2])] : null; },
    nudge: (ids, d) => {
      const doc = net.store?.doc;
      if (!doc || run.phase !== 'build') return;
      const ops = ids.map((id) => doc.parts.get(id)).filter((p): p is PartRecord => !!p && tools.pickable(p))
        .map((p) => ({ k: 'PartUpdate' as const, id: p.id, patch: { pos: [p.pos[0] + metresToPos(d[0]), Math.max(0, p.pos[1] + metresToPos(d[1])), p.pos[2] + metresToPos(d[2])] as [number, number, number] } }));
      if (ops.length) net.submit(ops.length === 1 ? ops[0]! : { k: 'Batch', ops });
    },
    click: () => { pick(); click({ shiftKey: false, ctrlKey: false, metaKey: false, detail: 1 } as PointerEvent); },
    partCount: () => net.store?.doc.parts.size ?? 0,
    placingLabel: () => partDef(selectedType)?.name ?? selectedType,
    deselect: () => tools.clickSelect(null, { shiftKey: false, ctrlKey: false, metaKey: false }),
    ports: () => {
      const out: PortInfo[] = [];
      const doc = net.store?.doc;
      if (doc) for (const p of doc.parts.values()) {
        const def = partDef(p.type);
        if (!def || !tools.pickable(p)) continue;
        def.ports.forEach((port, index) => { const w = portWorld(def, port, poseOf, p.id); if (w) out.push({ part: p.id, index, world: w, channel: port.channel, dir: port.dir, label: `${def.name}, ${port.name} port (${port.channel} ${port.dir})` }); });
      }
      return out;
    },
    parts: () => [...(net.store?.doc.parts.values() ?? [])].filter((p) => tools.pickable(p)).map((p) => ({ id: p.id, world: partPose(p).pos, label: partDef(p.type)?.name ?? p.type })),
    select: (id) => tools.clickSelect(id, { shiftKey: false, ctrlKey: false, metaKey: false }),
    openRadial: (x, y) => radial.show(x, y, radialSlots()),
    frameSelection: () => camRig.frame(),
    toast: ui.toast,
  });
  ui.keyboard(kb);

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  const trackPointer = (e: PointerEvent): void => {
    const r = canvas.getBoundingClientRect();
    pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; pointer.inside = true;
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    trackPointer(e);
    drag = { button: e.button, x: e.clientX, y: e.clientY };
    if (run.phase === 'build' && mover.carrying) { pick(); mover.pressWhileCarrying(e.button); drag = null; return; } // BUILDUX (D123): a click drops the paste ghost, a right click cancels it
    // DRAG (D117): a gizmo handle takes the press; otherwise, in the Select tool, a press on a part may become a drag
    if (e.button === 0 && run.phase === 'build') {
      pick();
      if (gizmo.down(pointer.x, pointer.y, modsOf(e))) return;
      if (tool === 'select') mover.down(pointer.x, pointer.y, hover, lockedUnder(), modsOf(e));
      // BUILDUX (D123), fixed: a marquee needs Shift (add) or Ctrl (toggle). A plain left-drag on empty space follows the
      // view rail (Orbit / Pan / Zoom), so the rail's choice works in the Select tool too.
      const mm = modsOf(e);
      if (tool === 'select' && !mover.holding && !hover?.part && (mm.shift || mm.ctrl)) boxSel.down(pointer.x, pointer.y, mm);
    }
  });
  canvas.addEventListener('pointercancel', () => { mover.cancel(true); mover.up(); gizmo.cancel(true); gizmo.up(); boxSel.cancel(); });
  canvas.addEventListener('pointerup', (e) => {
    // DRAG (D117): the end of a gizmo gesture or of a part drag is not a click; BUILDUX (D123): nor is a marquee
    if (gizmo.up() || mover.up() || boxSel.up()) { drag = null; return; }
    const moved = drag ? Math.hypot(e.clientX - drag.x, e.clientY - drag.y) : 99;
    if (drag?.button === 0 && moved < 5) {
      trackPointer(e); pick(); click(e);
      if (e.detail === 2 && tool === 'path') finishPath();
      // BETA (camera): double-click a part in the Select tool to frame it (F frames the selection)
      if (e.detail === 2 && tool === 'select' && run.phase === 'build' && hover?.part) camRig.frame();
    }
    if (drag?.button === 2 && moved < 5) { wireFrom = null; wirePts = []; pathPts = []; }
    drag = null;
  });
  canvas.addEventListener('pointermove', (e) => {
    trackPointer(e);
    mover.move(pointer.x, pointer.y, e.buttons, modsOf(e)); // DRAG (D117)
    gizmo.move(pointer.x, pointer.y, e.buttons, modsOf(e));
    boxSel.move(pointer.x, pointer.y, e.buttons, modsOf(e)); // BUILDUX (D123)
    if (radial.open) radial.move(pointer.x, pointer.y);
    if (drag && (drag.button === 2 || drag.button === 1)) {
      const dx = e.movementX, dy = e.movementY;
      if (drag.button === 2 && !e.shiftKey) {
        cam.yaw -= dx * 0.006;
        cam.pitch = Math.min(1.5, Math.max(0.05, cam.pitch + dy * 0.006));
      } else {
        const s = cam.dist * 0.0015;
        const right: V3 = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
        const fwd: V3 = [-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw)];
        cam.target = [cam.target[0] - right[0] * dx * s + fwd[0] * dy * s, cam.target[1], cam.target[2] - right[2] * dx * s + fwd[2] * dy * s];
      }
    }
  });
  canvas.addEventListener('pointerleave', () => { pointer.inside = false; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey) {
      if (mover.wheel(e.deltaY)) return; // DRAG (D117): mid-drag the badge shows the height, no toast
      // work plane height (HOW_TO_PLAY §3.2): placement and paths land on it when nothing is under the cursor
      workY =Math.max(0, Math.min(20, Math.round((workY - Math.sign(e.deltaY) * 0.1) * 10) / 10));
      ui.toast(`Work plane ${workY.toFixed(1)} m`);
      return;
    }
    // 400 m covers the Megastructure preset camera (≈ 104 m) with room to pull back over a whole world (M3 presets)
    cam.dist = Math.min(400, Math.max(0.3, cam.dist * Math.exp(e.deltaY * 0.001)));
  }, { passive: false });

  window.addEventListener('keyup', (e) => { if ((e.key === 'q' || e.key === 'Q') && radial.open && !radial.sticky) radial.keyUp(); }); // U4: a keyboard-opened radial is sticky; UIFIX (D122): a quick tap keeps a held one open
  window.addEventListener('keydown', (e) => {
    if (titleUp) return; // beta: the title screen takes no build keys (Play now is a button)
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { palette.toggle(); e.preventDefault(); return; }
    if (ui.chatOpen() || ui.typing() || palette.open) return;
    if (capture.keydown(e)) return; // C4: F10 photo mode, Shift+F10 capture dialog; photo mode holds the build keys
    const k = remapKey(e); // Settings › Controls remapping (stream D): handlers below see default keys
    if (mover.key(e, k) || gizmo.key(e, k)) return; // DRAG (D117): mid-gesture Esc cancels, R/T/Y turn, PageUp/PageDown lift
    if (buildKey(e, k)) return; // BUILDUX (D123): Ctrl+C / V / D, Alt+X / Y / Z, X (gizmo axes), Esc ends a marquee
    if (tools.keydown(e, k)) return;
    if ((k === ' ' || k === 'Enter') && document.activeElement instanceof HTMLButtonElement) return; // U4: a focused HUD button takes Space / Enter
    if (kb.keydown(e, k)) return; // U4: keyboard building aids (cursor, Enter, port cycling, sticky radial, camera keys)
    if (library.open && k === 'Escape') { library.toggle(false); return; }
    if (k === ' ' && e.shiftKey) { run.soloPreview(); e.preventDefault(); return; }
    if (run.phase === 'running') {
      if (k === '.') { run.step(1); return; }
      if (k === ',') { run.step(-1); return; }
      if (k === '=' || k === '+') { run.faster(1); return; }
      if (k === '-') { run.faster(-1); return; }
    }
    if ((k === 'q' || k === 'Q') && !e.repeat && !radial.open && pointer.inside) { radial.show(pointer.x, pointer.y, radialSlots()); return; }
    if (k === 'l' || k === 'L') { library.toggle(); e.preventDefault(); return; }
    if (k === 'F9') { perfHud = !perfHud; e.preventDefault(); return; }
    if (k === 'g' || k === 'G') { if (hover) net.send(['ping', { pos: hover.point, kind: 'look' }]); return; }
    if (k === 'p' || k === 'P') { pathKind = e.shiftKey ? 'tube_slim' : 'tube'; setTool('path'); ui.toast(`Path tool: ${pathKind === 'tube' ? 'TUBE' : 'slim TUBE'} · click points · Enter / double-click finishes`); return; }
    if (k === 'Enter' && tool === 'path') { finishPath(); return; }
    if (k >= '0' && k <= '9' && !e.ctrlKey) { const t = ui.hotbar((Number(k) + 9) % 10); if (t) choosePart(t); } // hotbar slots (stream U3)
    else if (k === '[' || k === ']') { const i = PALETTE.findIndex((p) => p.type === selectedType); choosePart(PALETTE[(i + (k === ']' ? 1 : PALETTE.length - 1)) % PALETTE.length]!.type); }
    else if (k === '/') { ui.openChat(); e.preventDefault(); }
    else if ((k === 'z' || k === 'Z') && (e.ctrlKey || e.metaKey)) { net.undo(e.shiftKey); audio.ui('undo'); e.preventDefault(); }
    else if ((k === 'y' || k === 'Y') && (e.ctrlKey || e.metaKey)) { net.undo(true); e.preventDefault(); }
    else if (k === ' ') { run.primary(); e.preventDefault(); }
    else if (k === 'Backspace') { run.stop(); e.preventDefault(); }
    else if (k === 'Escape') {
      // D84: Esc closes the topmost panel or menu, then cancels the current tool, and stops a run only when nothing else is open
      if (ui.escape()) return;
      if (wireFrom || pathPts.length) { wireFrom = null; wirePts = []; pathPts = []; }
      else if (run.phase === 'countdown') run.primary();
      else if (run.phase === 'running') run.stop();
      else setTool('place');
    }
    else if (k === 'v' || k === 'V') setTool('select');
    else if ((k === 'a' || k === 'A') && !e.ctrlKey && !e.metaKey && run.phase === 'build') gizmo.toggle(); // DRAG (D117): G is the ping key
    else if (k === 'e' || k === 'E') setTool('wire');
    else if ('rRtTyY'.includes(k) && k.length === 1 && !e.ctrlKey) rotate(k.toLowerCase() as 'r' | 't' | 'y', e.shiftKey ? -1 : 1);
    else if (k === 'Delete') {
      if (run.phase === 'build' && tools.deleteSelection()) { audio.ui('remove'); return; } // multi-select (stream D)
      const id = tool === 'select' && selectedId ? selectedId : hover?.part?.id;
      if (run.phase === 'build' && id) { net.submit({ k: 'PartRemove', ids: [id] }); audio.ui('remove'); if (id === selectedId) { selectedId = null; ui.inspect(null); } }
    } else if (k === 'f' || k === 'F') { camRig.frame(); } // stream C: frame the selection (cameras.ts)
    else if ((k === 'c' || k === 'C') && !e.ctrlKey && !e.metaKey) { ui.toast(`Camera: ${camRig.cycle()}`); } // stream C: cycle camera mode
  });

  /** R/T/Y: yaw/pitch/roll by 15° (Shift reverses): the ghost while placing, the selection otherwise. */
  function rotate(axis: 'r' | 't' | 'y', dir: number): void {
    const step = 15 * dir;
    audio.ui('rotate');
    if (tool === 'select' && selectedId && run.phase === 'build') {
      const p = net.store?.doc.parts.get(selectedId);
      if (!p) return;
      const e = eulerOf(p.rot);
      if (axis === 'r') e.yaw += step; else if (axis === 't') e.pitch += step; else e.roll += step;
      net.submit({ k: 'PartUpdate', id: p.id, patch: { rot: snappedEuler(e.yaw, e.pitch, e.roll) } });
      return;
    }
    if (axis === 'r') ghostRot.yaw += step; else if (axis === 't') ghostRot.pitch += step; else ghostRot.roll += step;
  }

  /** BUILDUX (D123): the build keys of the polish pass. True when consumed. */
  function buildKey(e: KeyboardEvent, k: string): boolean {
    if (k === 'Escape' && boxSel.active) { boxSel.cancel(); return true; }
    const ctrl = e.ctrlKey || e.metaKey, low = k.length === 1 ? k.toLowerCase() : k;
    if (ctrl && !e.altKey && !e.shiftKey && (low === 'c' || low === 'v' || low === 'd')) {
      e.preventDefault(); // Ctrl+D would bookmark the page
      if (low === 'c') clipTool.copy();
      else if (run.phase !== 'build') ui.toast('Stop the run to paste');
      else if (low === 'v') clipTool.paste();
      else clipTool.duplicate();
      return true;
    }
    if (e.altKey && !ctrl && (e.code === 'KeyX' || e.code === 'KeyY' || e.code === 'KeyZ')) { e.preventDefault(); mirrorSel(e.code === 'KeyX' ? 0 : e.code === 'KeyY' ? 1 : 2); return true; }
    if (low === 'x' && !ctrl && !e.altKey && !e.shiftKey && run.phase === 'build') { gizmo.toggleAxes(); return true; }
    return false;
  }

  /** BUILDUX (D123): Alt+X / Y / Z mirror the selection across its centre plane (ui/mirror.ts), one op. */
  function mirrorSel(a: Axis): void {
    const doc = net.store?.doc;
    if (!doc) return;
    const ids = moveHost.selection().filter((id) => doc.parts.has(id));
    if (!ids.length) { ui.toast('Select the parts to mirror'); return; }
    const refuse = (why: string): void => { ui.toast(why, 'warn'); announce(why, 'assertive'); audio.ui('error'); };
    const why = moveRefusal(moveHost, ids);
    if (why) { refuse(why); return; }
    const r = mirrorSelection(doc, ids, a, moveHost.floor());
    if (r.refusal) { refuse(`Can't mirror: ${r.refusal}`); return; }
    if (!r.op || !net.submit(r.op)) return;
    const names = [...new Set(r.kept.map((p) => partDef(p.type)?.name ?? p.type))];
    const kept = names.length ? ` · ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''} kept ${r.kept.length === 1 ? 'its' : 'their'} turn (no mirror image)` : '';
    const msg = `Mirrored ${ids.length} part${ids.length === 1 ? '' : 's'} across ${AXIS_NAME[a]}${kept}`;
    ui.toast(msg, r.kept.length ? 'warn' : 'info');
    announce(msg);
    audio.ui('rotate');
    gizmo.invalidate();
  }

  // ---- geometry helpers ------------------------------------------------------------------------------
  const ghostQuat = (): Q4 => rotationToQuat(snappedEuler(ghostRot.yaw, ghostRot.pitch, ghostRot.roll)) as Q4;
  const propsOf = (p: PartRecord, def: PartDef) => propValues(def, p.props);

  // DRAG (D117): worldBox, the grid snap, the resting surface and the overlap test live in ui/dragmove.ts, shared with
  // drag-to-move and the gizmo
  /** Top of a part's bounds (where a ghost rests when the cursor hits the part's side). */
  function partTop(p: PartRecord): number {
    const hd = partDef(p.type);
    return hd ? worldBox(hd, propsOf(p, hd), runPose(p)).max[1] : posToMetres(p.pos[1]);
  }

  function ghostPose(fine: boolean): Pose | null {
    if (!hover) return null;
    const def = partDef(selectedType)!;
    const rot = ghostQuat();
    const local = worldBox(def, propValues(def), { pos: [0, 0, 0], rot });
    const step = fine ? 0.025 : 0.1;
    // a part's top, the floor, the Backlot terrain (U3) or the raised work plane (DRAG: the plane used to count only for x/z)
    const base = surfaceY(hover, partTop);
    const pose: Pose = { pos: [snap(hover.point[0], step), base - local.min[1], snap(hover.point[2], step)], rot };
    // BUILDUX (D124): a port within 5 cm of a compatible port pulls the ghost onto it (Alt = off; never into a blocked spot)
    const doc = net.store?.doc;
    if (!doc) return pose;
    const r = snapPlacement(def, pose, doc, altDown(), (p) => tools.pickable(p), (pz) => blockedBy(def, pz) !== null);
    placeSnap = r.info;
    return r.pose;
  }

  /** The part the ghost would overlap (touching is fine; 1 mm tolerance), or null: the same test drag-to-move uses. */
  function blockedBy(def: PartDef, pose: Pose): PartRecord | null {
    if (!net.store) return null;
    return overlapOf(worldBox(def, propValues(def), pose), net.store.doc.parts.values(), partBox);
  }

  /** A placement-style ghost (translucent, player colour or red when blocked). */
  function ghostOf(def: PartDef, rec: PartRecord, pose: Pose, tint: readonly [number, number, number], blocked: boolean, out: SceneItem[]): void {
    for (const it of partItems(def, rec, pose, { artMesh, flags: 0 }, 'all', -1, null)) out.push({ ...it, color: tint, alpha: blocked ? 0.5 : 0.35, emissive: 0, outline: null });
  }

  // ---- poses (build: from the doc; run: from the sim's transforms) -----------------------------------
  const bodyIndex = new Map<string, number>();
  const partIndex = new Map<number, number>();
  function indexRun(): void {
    bodyIndex.clear(); partIndex.clear();
    run.bodies.forEach((b, i) => bodyIndex.set(`${b.part}:${b.role}`, i));
    run.partIds.forEach((id, i) => partIndex.set(id, i));
  }
  const poseOf: PoseOf = (id, role) => {
    if (run.phase === 'running' && run.transforms.length) {
      const bi = bodyIndex.get(`${id}:${role}`) ?? bodyIndex.get(`${id}:base`);
      if (bi === undefined) return null;
      const t = run.transforms, o = bi * 7;
      return { pos: [t[o]!, t[o + 1]!, t[o + 2]!], rot: [t[o + 3]!, t[o + 4]!, t[o + 5]!, t[o + 6]!] };
    }
    const mv = run.phase === 'build' ? moving()?.pose(id) : undefined; // DRAG (D117): links and ports follow the ghosts
    if (mv) return mv;
    const p = net.store?.doc.parts.get(id);
    return p ? partPose(p) : null;
  };
  const runPose = (p: PartRecord): Pose => poseOf(p.id, 'base') ?? partPose(p);

  // ---- picking ---------------------------------------------------------------------------------------
  function ray(): { o: V3; d: V3 } | null {
    if (!pointer.inside) return null;
    const ndcX = (pointer.x / canvas.clientWidth) * 2 - 1;
    const ndcY = 1 - (pointer.y / canvas.clientHeight) * 2;
    const inv = invert(renderer.viewProj);
    const a = transform(inv, [ndcX, ndcY, 0]);
    const b = transform(inv, [ndcX, ndcY, 1]);
    const o: V3 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
    const f: V3 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
    return { o, d: [f[0] - o[0], f[1] - o[1], f[2] - o[2]] };
  }

  /** Ray vs every part's oriented bounds, then the floor. */
  function pick(): void {
    const r = ray();
    if (!r || !net.store) { hover = null; hoverPort = null; return; }
    // hidden/locked layers and parts, section box (stream D); DRAG (D117): not the parts being dragged
    const near = rayParts(r, (p) => tools.pickable(p) && !mover.excludes(p.id));
    let hit: Hit | null = near?.hit ?? null;
    // DRAG (D117): while dragging, a raised work plane hides what is under it, so a part can be lifted over others
    if (hit && near && mover.active && run.phase === 'build' && workY > 0 && r.d[1] < 0 && r.o[1] > workY && (workY - r.o[1]) / r.d[1] < near.t) hit = null;
    // S3 Backlot (U3): no part under the cursor → the terrain, before the flat work plane
    const terr = !hit ? net.store.doc.activeTerrain() : null;
    const th = terr ? terrainHit(terr, r.o, r.d) : null;
    if (th) hit = { point: th, part: null, normal: [0, 1, 0] };
    const planeY = run.phase === 'build' ? workY : 0;
    if (!hit && r.d[1] < 0 && r.o[1] > planeY) {
      const t = (planeY - r.o[1]) / r.d[1];
      hit = { point: [r.o[0] + r.d[0] * t, planeY, r.o[2] + r.d[2] * t], part: null, normal: [0, 1, 0] };
    }
    hover = hit;
    hoverPort = tool === 'wire' ? pickPort() : null;
  }

  /** DRAG (D117): why the nearest thing under the pointer can't be dragged, when it is a locked part (else null). */
  function lockedUnder(): string | null {
    const r = ray(), doc = net.store?.doc;
    if (!r || !doc) return null;
    const lk = rayParts(r, (p) => !tools.pickable(p) && partVisible(doc, p) && lockedReason(doc, p) !== null);
    if (!lk?.hit.part) return null;
    const ok = rayParts(r, (p) => tools.pickable(p));
    return ok && ok.t < lk.t ? null : lockedReason(doc, lk.hit.part);
  }

  /** The nearest part along a ray among those `accept` lets through (oriented bounds). */
  function rayParts(r: { o: V3; d: V3 }, accept: (p: PartRecord) => boolean): { t: number; hit: Hit } | null {
    if (!net.store) return null;
    let best = Infinity;
    let hit: Hit | null = null;
    for (const p of net.store.doc.parts.values()) {
      const def = partDef(p.type);
      if (!def || !accept(p)) continue;
      const pose = runPose(p);
      const b = boundsOf(def, propsOf(p, def));
      const qi = qinv(pose.rot);
      const o = qrot(qi, [r.o[0] - pose.pos[0], r.o[1] - pose.pos[1], r.o[2] - pose.pos[2]]);
      const d = qrot(qi, r.d);
      let tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(d[i]!) < 1e-9) { if (o[i]! < b.min[i]! || o[i]! > b.max[i]!) { tmin = Infinity; break; } continue; }
        let t1 = (b.min[i]! - o[i]!) / d[i]!, t2 = (b.max[i]! - o[i]!) / d[i]!;
        let s = -1;
        if (t1 > t2) { [t1, t2] = [t2, t1]; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
        tmax = Math.min(tmax, t2);
      }
      if (tmin <= tmax && tmin > 0 && tmin < best && axis >= 0) {
        best = tmin;
        const nl = [0, 0, 0]; nl[axis] = sign;
        hit = { point: [r.o[0] + r.d[0] * tmin, r.o[1] + r.d[1] * tmin, r.o[2] + r.d[2] * tmin], part: p, normal: qrot(pose.rot, nl) };
      }
    }
    return hit ? { t: best, hit } : null;
  }

  /** Nearest port within 18 px of the pointer (wire tool). */
  function pickPort(): PortRef | null {
    if (!net.store) return null;
    let best = 18 * 18;
    let found: PortRef | null = null;
    for (const p of net.store.doc.parts.values()) {
      const def = partDef(p.type);
      if (!def || !tools.pickable(p)) continue;
      def.ports.forEach((port, index) => {
        const w = portWorld(def, port, poseOf, p.id);
        if (!w) return;
        const c = transform(renderer.viewProj, w);
        if (c[3] <= 0) return;
        const x = ((c[0] / c[3]) * 0.5 + 0.5) * canvas.clientWidth, y = (1 - ((c[1] / c[3]) * 0.5 + 0.5)) * canvas.clientHeight;
        const d2 = (x - pointer.x) ** 2 + (y - pointer.y) ** 2;
        if (d2 < best) { best = d2; found = { part: p, def, port, index, world: w }; }
      });
    }
    return found;
  }

  // ---- clicks ------------------------------------------------------------------------------------------
  function click(e: PointerEvent): void {
    if (run.phase === 'running') {
      // Hand-of-God: press buttons; Ctrl+click shoves a part away from the camera
      const p = hover?.part;
      if (!p) return;
      const def = partDef(p.type);
      if (p.type === 'the_button') run.poke(p.id, 'impulse', [0, -1, 0]);
      else if (e.ctrlKey && def?.body.kind === 'dynamic') {
        const r = ray()!;
        const len = Math.hypot(...r.d);
        const m = def.body.mass, dv = 3;
        run.poke(p.id, 'impulse', [(r.d[0] / len) * m * dv, m * dv * 0.5, (r.d[2] / len) * m * dv]);
      }
      return;
    }
    if (run.phase !== 'build' || !net.store || !net.me) return;
    if (tool === 'select') {
      tools.clickSelect(hover?.part?.id ?? null, e); // Shift/Ctrl+click multi-selects (stream D)
      return;
    }
    if (tool === 'wire') { wire(); return; }
    if (tool === 'path') {
      // tube centreline sits a radius above whatever was clicked
      if (hover) { const s = (e.shiftKey ? 0.025 : 0.1); const sn = (x: number): number => Math.round(x / s) * s; pathPts.push([sn(hover.point[0]), hover.point[1] + (pathKind === 'tube' ? 0.15 : 0.06), sn(hover.point[2])]); }
      return;
    }
    const pose = ghostPose(e.shiftKey);
    if (!pose) return;
    const def = partDef(selectedType)!;
    const hit = blockedBy(def, pose);
    if (hit) { ui.toast(`Blocked: overlaps ${partDef(hit.type)?.name ?? hit.type}`, 'warn'); return; }
    const capped = tools.placementRefusal(def.type); // U5 (M5): per-world caps (SINGULARITY 4)
    if (capped) { ui.toast(capped, 'warn'); return; }
    audio.ui('place');
    net.submit({
      k: 'PartAdd',
      part: { id: net.nextId(), type: def.type, pos: [metresToPos(pose.pos[0]), metresToPos(pose.pos[1]), metresToPos(pose.pos[2])], rot: snappedEuler(ghostRot.yaw, ghostRot.pitch, ghostRot.roll), flags: 0, ...tools.newPartFields(def.type) }, // U5 (M5): + the pair colour for RIFT GATES / BUZZ
    });
  }

  /** Wire tool: port → port makes the link its channel uses (PART_SYSTEM §3). */
  function wire(): void {
    // clicking empty space while wiring drops a waypoint (fuses burn along the whole route)
    if (!hoverPort) { if (wireFrom && hover) wirePts.push([hover.point[0], hover.point[1] + 0.01, hover.point[2]]); else wireFrom = null; return; }
    if (!wireFrom) { wireFrom = hoverPort; wirePts = []; return; }
    const a = wireFrom, b = hoverPort;
    const via = a.port.dir === 'in' ? [...wirePts].reverse() : wirePts;
    wireFrom = null;
    wirePts = [];
    if (a.part.id === b.part.id && a.index === b.index) return;
    if (a.port.channel !== b.port.channel) { ui.toast(`Can't connect ${a.port.channel} to ${b.port.channel}`, 'warn'); return; }
    if ((a.port.channel === 'signal' || a.port.channel === 'power') && a.port.dir === b.port.dir && a.port.dir !== 'both') {
      ui.toast(`Connect an output to an input`, 'warn'); return;
    }
    for (const r of [a, b]) {
      const used = [...net.store!.doc.links.values()].filter((l) => (l.from?.part === r.part.id && l.from.port === r.index) || (l.to?.part === r.part.id && l.to.port === r.index)).length;
      if (used >= (r.port.maxLinks ?? 1)) { ui.toast(`${r.def.name} ${r.port.name} is full`, 'warn'); return; }
    }
    const kind = LINK_FOR_CHANNEL[a.port.channel] as LinkKind | null;
    if (!kind) return;
    // signal and power run output → input
    const [from, to] = a.port.dir === 'in' ? [b, a] : [a, b];
    const link: LinkRecord = {
      id: net.nextId(), kind, from: { part: from.part.id, port: from.index }, to: { part: to.part.id, port: to.index }, via: [],
      points: via.map((q) => [metresToPos(q[0]), metresToPos(q[1]), metresToPos(q[2])] as [number, number, number]), length: 0,
    };
    net.submit({ k: 'LinkAdd', link });
    audio.ui('wire');
  }

  /** Path tool: the clicked points become a TUBE run (a link with no ports, frame.md). */
  function finishPath(): void {
    if (pathPts.length >= 2 && net.store) {
      const link: LinkRecord = {
        id: net.nextId(), kind: pathKind, from: null, to: null, via: [],
        points: pathPts.map((q) => [metresToPos(q[0]), metresToPos(q[1]), metresToPos(q[2])] as [number, number, number]), length: 0,
      };
      net.submit({ k: 'LinkAdd', link });
    }
    pathPts = [];
  }

  /** Radial menu slots (UI_UX §4.7) for the part under the cursor. */
  function radialSlots() {
    const subject = hover?.part ?? null; // UIFIX (D122): the part under the cursor when the menu opened (pointing at a wedge moves the hover)
    const target = (): PartRecord | null => (subject ? net.store?.doc.parts.get(subject.id) ?? null : null);
    const building = (): boolean => run.phase === 'build' && target() !== null;
    return [
      { label: 'Rotate', enabled: building, run: () => { const p = target(); if (p) { const e = eulerOf(p.rot); net.submit({ k: 'PartUpdate', id: p.id, patch: { rot: snappedEuler(e.yaw + 90, e.pitch, e.roll) } }); } } },
      { label: 'Duplicate', enabled: building, run: () => { const p = target(); if (p) { selectedType = p.type; ghostRot = eulerOf(p.rot); setTool('place'); } } },
      { label: 'Connect', enabled: () => true, run: () => setTool('wire') },
      { label: 'Anchor', enabled: () => building() && partDef(target()!.type)?.body.kind === 'dynamic', run: () => { const p = target(); if (p) net.submit({ k: 'PartUpdate', id: p.id, patch: { flags: p.flags ^ 32 } }); } },
      { label: 'Lock', enabled: building, run: () => { const p = target(); if (p) net.send(['lock', { ids: [p.id] }]); } },
      { label: 'Inspect', enabled: building, run: () => { const p = target(); if (p) { setTool('select'); selectedId = p.id; ui.inspect(p); } } },
      { label: 'Library', enabled: () => true, run: () => library.toggle(true) },
      { label: 'Delete', enabled: building, run: () => { const p = target(); if (p) net.submit({ k: 'PartRemove', ids: [p.id] }); } },
    ];
  }

  palette.commands = (): Command[] => [
    { label: 'Let it rip', hint: 'Space', run: () => run.primary() },
    { label: 'Solo preview (only you)', hint: 'Shift+Space', run: () => run.soloPreview() },
    { label: 'Stop the run', hint: 'Backspace', run: () => run.stop() },
    { label: 'Undo', hint: 'Ctrl+Z', run: () => net.undo(false) },
    { label: 'Redo', hint: 'Ctrl+Shift+Z', run: () => net.undo(true) },
    { label: 'Place tool', hint: 'B', run: () => setTool('place') },
    { label: 'Select tool', hint: 'V', run: () => setTool('select') },
    { label: 'Wire tool', hint: 'E', run: () => setTool('wire') },
    { label: 'Path tool: TUBE', hint: 'P', run: () => { pathKind = 'tube'; setTool('path'); } },
    { label: 'Path tool: slim TUBE', hint: 'Shift+P', run: () => { pathKind = 'tube_slim'; setTool('path'); } },
    { label: 'Open the Library', hint: 'L', run: () => library.toggle(true) },
    { label: 'Work plane to floor', run: () => { workY = 0; } },
    { label: gizmo.on ? 'Gizmo: hide (move / turn / resize handles)' : 'Gizmo: show (move / turn / resize handles)', hint: 'A', run: () => gizmo.toggle() }, // DRAG (D117)
    // BUILDUX (D123–D124)
    { label: gizmo.local ? 'Gizmo: world axes (arrows along X / Y / Z)' : 'Gizmo: local axes (arrows follow the part’s turn)', hint: 'X', run: () => gizmo.toggleAxes() },
    { label: 'Copy selection', hint: 'Ctrl+C', run: () => clipTool.copy() },
    { label: 'Paste', hint: 'Ctrl+V', run: () => { if (run.phase === 'build') { setTool('select'); clipTool.paste(); } } },
    { label: 'Duplicate selection', hint: 'Ctrl+D', run: () => { if (run.phase === 'build') clipTool.duplicate(); } },
    ...([0, 1, 2] as const).map((a) => ({ label: `Mirror selection across ${AXIS_NAME[a]}`, hint: `Alt+${AXIS_NAME[a]}`, run: () => mirrorSel(a) })),
    { label: portSnapOn() ? 'Snap to ports: off' : 'Snap to ports: on', run: () => { setSetting('controls.portSnap', !portSnapOn()); ui.toast(portSnapOn() ? 'Snap to ports on · Alt places freely' : 'Snap to ports off'); } },
    { label: 'Clear ghost trails', run: () => { trails = []; } },
    { label: 'Studio: light cyc', run: () => { renderer.look = STUDIO_LIGHT; } },
    { label: 'Studio: dark cyc', run: () => { renderer.look = STUDIO_DARK; } },
    { label: 'Ping here', hint: 'G', run: () => { if (hover) net.send(['ping', { pos: hover.point, kind: 'look' }]); } },
    ...tools.commands(), // outliner, layers, modules, section box, X-ray, cutaway, settings, environment (stream D)
    ...PALETTE.map((p) => ({ label: `Part: ${p.name} (${p.tag})`, run: () => choosePart(p.type) })),
  ];

  // ---- inspector -------------------------------------------------------------------------------------
  ui.onProp((id, key, value) => {
    const p = net.store?.doc.parts.get(id);
    const def = p ? partDef(p.type) : undefined;
    if (!p || !def) return;
    if (key === '__anchored') { net.submit({ k: 'PartUpdate', id, patch: { flags: value ? p.flags | 32 : p.flags & ~32 } }); return; }
    const cur: Record<string, number> = { ...propValues(def, p.props) };
    cur[key] = value;
    const list = Object.keys(def.props).map((k) => propSteps(def, k, cur[k]!) as [number, number]);
    net.submit({ k: 'PartUpdate', id, patch: { props: list } });
  });
  ui.onUnlink((id) => net.submit({ k: 'LinkRemove', ids: [id] }));
  ui.onDelete((id) => { net.submit({ k: 'PartRemove', ids: [id] }); selectedId = null; ui.inspect(null); });

  // ---- partner presence ------------------------------------------------------------------------------
  let partner: ServerMsgs['presence'] | null = null;
  net.on((e) => {
    if (e.type === 'presence') partner = e.msg;
    if (e.type === 'peers' && !net.partner()) partner = null;
  });

  // ---- scene -----------------------------------------------------------------------------------------
  let sceneDirty = true;
  let sceneKey = '';
  let lastTransforms: Float32Array | null = null;
  let hookedStore: typeof net.store = null;
  let instancesOf = new Map<number, number[]>();
  net.on((e) => {
    if (e.type === 'doc' || e.type === 'locks') sceneDirty = true;
    if (e.type === 'doc') { gizmo.invalidate(); invalidatePortIndex(); } // DRAG (D117): re-measure the selection's bounds; BUILDUX: re-index ports
    if (e.type === 'doc' && selectedId) ui.inspect(net.store?.doc.parts.get(selectedId) ?? null);
  });

  // G3 (M3): FABRICATOR / SKYSHOW pool slots (A3) are drawn only while in play: a dormant slot waits parked
  // 30 m under its part. The scene key carries one bit per pool body, so a spawn or recycle rebuilds the scene.
  let poolOf: { bodies: unknown; list: number[] } = { bodies: null, list: [] };
  const poolInPlay = (bi: number): boolean => {
    const b = run.bodies[bi];
    const p = b ? net.store?.doc.parts.get(b.part) : undefined;
    return !p || (run.transforms[bi * 7 + 1] ?? -1e9) > posToMetres(p.pos[1]) - 10;
  };
  const poolKey = (): string => {
    if (run.phase !== 'running') return '';
    if (poolOf.bodies !== run.bodies) {
      const list: number[] = [];
      run.bodies.forEach((b, bi) => { if (b.role === 'piece' && POOL_PARTS.has(b.type)) list.push(bi); });
      poolOf = { bodies: run.bodies, list };
    }
    let k = '';
    for (const bi of poolOf.list) k += poolInPlay(bi) ? '1' : '0';
    return k;
  };

  function rebuildScene(): void {
    const data = new InstanceData();
    const doc = net.store?.doc;
    instancesOf = new Map();
    if (doc && run.phase === 'running' && run.bodies.length) {
      fillRunScene(data, run.bodies, doc.parts, partIndex, run.flags, { artMesh }, run.meters, poolInPlay); // G3: pool slots
    } else if (doc) {
      // hidden layers/parts and the section box fallback are left out; the selection is outlined (stream D)
      const r = fillBuildScene(data, tools.visibleParts(doc), { artMesh }, (id) => { const s = net.locks.get(id); return tools.outline(id) ?? (s ? PLAYER_RGB[s]! : null); });
      instancesOf = r.instances;
    }
    renderer.setScene(data);
    // R4 (M4): the containers the fill pass draws (re-listed with the scene, not per frame)
    containerParts = doc ? [...doc.parts.values()].filter((p) => CONTAINER_TYPES.has(p.type)).map((p) => {
      const def = partDef(p.type);
      return { id: p.id, type: p.type, props: def ? propValues(def, p.props) : {} };
    }) : [];
  }

  // ---- sim events → Spectacle --------------------------------------------------------------------------
  run.onEvents((events: SimEvent[]) => {
    for (const ev of events) {
      const p = ev.pos as V3;
      { // R5 (M5): every event touching an M5 part goes to the Future Tech effects too (rift transits, wall impacts, coilgun fire)
        const parts = net.store?.doc.parts;
        const pt = parts?.get(ev.part)?.type ?? '', ot = ev.other !== undefined && ev.other >= 0 ? parts?.get(ev.other)?.type ?? '' : '';
        if (FUTURE_TYPES.has(pt) || FUTURE_TYPES.has(ot)) future.event(ev.kind, ev.part, pt, p, ev.mag, null, ot);
      }
      switch (ev.kind) {
        case 'Detonate':
          // G3 (M3): volumetric fireball / keg mushroom, debris, shock ring, flash limiter, hitstop + slow-mo
          fx.boom(p, ev.mag, net.store?.doc.parts.get(ev.part)?.type ?? '');
          if (!settings.comfort.reducedMotion) cam.trauma = Math.min(1, cam.trauma + 0.25 * Math.cbrt(ev.mag) * Math.max(0.3, 1 - dist(p, eyeOf()) / 30));
          break;
        case 'Ignite': case 'FuseLit': fx.ignite(p); break;
        case 'Pop': fx.puff(p); fx.dust([p[0], p[1], p[2]], 0.1); break;
        case 'Extinguish': fx.puff(p); break;
        case 'Cut': fx.puff(p); break;
        case 'Impact': if (ev.mag >= 20) fx.dust(p, ev.mag / 60); break;
        case 'Break': {
          // G3 (M3): debris chunklets from the part's bounds in its master's look
          const bp = net.store?.doc.parts.get(ev.part);
          const bd = bp ? partDef(bp.type) : undefined;
          const half: V3 = bd ? [0, 1, 2].map((a) => Math.max(0.01, (bd.bounds.max[a]! - bd.bounds.min[a]!) / 2)) as V3 : [0.05, 0.05, 0.05];
          fx.shatter(p, bp?.type ?? '', half);
          fx.simEvent('Break', p, ev.mag, bp?.type ?? ''); // R4 (M4): YOLK adds the egg splat
          break;
        }
        case 'Jam': case 'Brownout': fx.puff(p); renderer.flash(p, [1.2, 0.8, 0.1], 0.5, 0.4); break;
        case 'Signal': case 'Press': signalFlash.set(ev.part, performance.now()); break;
        default: {
          // R4 (M4): the M4 kinds by name (Splash, Arc, Splat, sand puffs); unknown kinds are ignored
          const op = ev.other !== undefined && ev.other >= 0 ? poseOf(ev.other, 'base') : null;
          fx.simEvent(ev.kind, p, ev.mag, net.store?.doc.parts.get(ev.part)?.type ?? '', op ? op.pos as V3 : null);
        }
      }
    }
  });
  const signalFlash = new Map<number, number>();

  // R5 (M5): the M5 parts' state → the Future Tech effects (gfx/future): poses, props, flags and meters each frame. In
  // Build only RIFT GATES show (their idle membrane); fields start with the run.
  const futureList: FuturePart[] = [];
  function futureFrame(dt: number): void {
    futureList.length = 0;
    const doc = net.store?.doc;
    const running = run.phase === 'running' && run.bodies.length > 0;
    if (running && !partIndex.size) indexRun();
    if (doc) for (const p of doc.parts.values()) {
      if (!FUTURE_TYPES.has(p.type)) continue;
      if (!running && p.type !== 'rift_gate') continue;
      const def = partDef(p.type);
      const i = running ? partIndex.get(p.id) : undefined;
      const pose = running ? poseOf(p.id, 'base') ?? partPose(p) : partPose(p);
      futureList.push({
        id: p.id, type: p.type, pos: pose.pos as V3, rot: pose.rot, placed: partPose(p), props: def ? propValues(def, p.props) : {},
        flags: i !== undefined ? run.flags[i] ?? 0 : 0, meter: i !== undefined ? run.meters[i] ?? 0 : 0,
      });
    }
    future.frame(futureList, { running, tick: run.tick, tickRate: run.tickRate, reducedMotion: settings.comfort.reducedMotion, reduceFlashing: settings.comfort.reduceFlashing }, dt);
    if (future.lensActive) fx.shock.shellsOn = false; // boom.md: no blast refraction while the Singularity lenses
    // the wetness grid: over the Kitchen sink (the preset's `sink_floor` collider, + 0.6 m), elsewhere 8 m round the origin
    const sink = doc?.env.environment === 'kitchen' ? kitchenSink(doc.env.preset) : null;
    if (sink) { const s = Math.max(sink.half[0]!, sink.half[2]!) + 0.6; wetness.setRect(sink.center[0]! - s, sink.center[2]! - s, 2 * s); } else wetness.setRect(-4, -4, 8);
  }
  // R5 (M5): GRABBER's turret turns with the arm's yaw (taken from the upper-arm body against the base body) in a run
  let turretsFor: unknown = null;
  let turrets: { link0: number; base: number; mesh: number[] }[] = [];
  // R5 (M5): GRABBER's fingers slide on the gripper link's body by Machine.grabberJoints' opening (run.grabbers)
  let fingers: { type: string; part: number; link: number; f: number; mesh: number[] }[] = [];
  function grabberTurrets(overlay: SceneItem[]): void {
    if (run.phase !== 'running' || !run.transforms.length) return;
    if (turretsFor !== run.bodies) {
      turretsFor = run.bodies;
      turrets = [];
      fingers = [];
      const baseOf = new Map<number, number>();
      run.bodies.forEach((b, bi) => { if (b.role === 'base' && ARTICULATED[b.type]) baseOf.set(b.part, bi); });
      run.bodies.forEach((b, bi) => {
        const ar = ARTICULATED[b.type], art = partDef(b.type)?.art;
        if (b.role !== 'piece' || !ar || !art) return;
        const meshes = (n: string): number[] => [artMesh(n), artMesh(`${n}:glass`)].filter((m): m is number => m !== null);
        if (ar.fingers && (b.chunk ?? 0) === ar.fingers.link) ar.fingers.pivots.forEach((_, f) => { const mesh = meshes(`${art}:finger:${f}`); if (mesh.length) fingers.push({ type: b.type, part: b.part, link: bi, f, mesh }); });
        if ((b.chunk ?? 0) !== 0) return;
        const base = baseOf.get(b.part), mesh = meshes(`${art}:turret`);
        if (base !== undefined && mesh.length) turrets.push({ link0: bi, base, mesh });
      });
    }
    const t = run.transforms;
    const grip = gripOf(run.grabbers);
    for (const g of fingers) {
      const i = partIndex.get(g.part);
      if (i === undefined || ((run.flags[i] ?? 0) & (PartFlagBits.dead | PartFlagBits.broken)) !== 0) continue;
      const lq: Q4 = [t[g.link * 7 + 3]!, t[g.link * 7 + 4]!, t[g.link * 7 + 5]!, t[g.link * 7 + 6]!];
      const d = qrot(lq, fingerOffset(g.type, g.f, grip.get(i)?.open ?? ARTICULATED[g.type]!.fingers!.rest));
      for (const mesh of g.mesh) overlay.push({ pos: [t[g.link * 7]! + d[0], t[g.link * 7 + 1]! + d[1], t[g.link * 7 + 2]! + d[2]], rot: lq, size: [1, 1, 1], mesh, color: [1, 1, 1], ...(renderer.lib.meshes[mesh]?.glass ? { glass: true } : {}) });
    }
    for (const g of turrets) {
      const bq: Q4 = [t[g.base * 7 + 3]!, t[g.base * 7 + 4]!, t[g.base * 7 + 5]!, t[g.base * 7 + 6]!];
      const lq: Q4 = [t[g.link0 * 7 + 3]!, t[g.link0 * 7 + 4]!, t[g.link0 * 7 + 5]!, t[g.link0 * 7 + 6]!];
      // the upper arm's local +X = the yaw turn of +X (the shoulder pitches about it)
      const x = qrot(qinv(bq), qrot(lq, [1, 0, 0]));
      const yaw = Math.atan2(-x[2], x[0]);
      const rot = qmulQ(bq, [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]);
      for (const mesh of g.mesh) overlay.push({ pos: [t[g.base * 7]!, t[g.base * 7 + 1]!, t[g.base * 7 + 2]!], rot, size: [1, 1, 1], mesh, color: [1, 1, 1], ...(renderer.lib.meshes[mesh]?.glass ? { glass: true } : {}) });
    }
  }
  const qmulQ = (a: Q4, b: Q4): Q4 => [
    a[3] * b[0] + b[3] * a[0] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] + b[3] * a[1] + a[2] * b[0] - a[0] * b[2],
    a[3] * b[2] + b[3] * a[2] + a[0] * b[1] - a[1] * b[0], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  function kitchenSink(preset: string): { center: readonly number[]; half: readonly number[] } | null {
    const presets = KITCHEN.presets as Record<string, { boxes: readonly { name: string; center: readonly number[]; half: readonly number[] }[] } | undefined>;
    return presets[preset]?.boxes.find((b) => b.name === 'sink_floor') ?? null;
  }
  net.on((e) => {
    if (e.type === 'ping') {
      pings.push({ pos: e.msg.pos as V3, by: e.msg.by, until: performance.now() + 3000 });
      if (e.msg.by !== net.me?.slot) { ui.toast(`${net.partner()?.name ?? 'Your partner'} pinged`); if (settings.multiplayer.pingSounds) audio.ui('chat'); } // U5 (M5): Settings › Multiplayer › Ping sounds had no consumer
    }
    if (e.type === 'doc' && run.phase === 'build') trails = []; // an edit invalidates last run's trails
  });
  const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // ---- frame loop --------------------------------------------------------------------------------------
  let lastNow = performance.now();
  let lastPhase = run.phase;
  const lastPos = new Map<number, V3>();
  function frame(external = false): void {
    if (renderer.lostReason) { showBlocker('Graphics restarted', `The GPU device was lost (${renderer.lostReason}). Reload to continue.`); return; }
    if (capture.busy && !external) { schedule(); return; } // C4: an offline render draws its own frames
    const now = performance.now();
    const dt = capture.frozen ? 0 : Math.min(0.1, (now - lastNow) / 1000); // C4: photo mode holds time still
    lastNow = now;
    // stream C: the camera rig picks the shot (mode, framing tween, trauma shake scaled by comfort settings)
    // C4: photo mode, a saved path or a fixed capture camera override it
    const shot = capture.shot() ?? camRig.update(dt, now);
    const eye = shot.eye;
    const clean = capture.clean; // C4: no ghost, ports, cursor, pings or trails in photos and clips
    // G3 (M3): hitstop / slow-mo (wall clock, local playhead only), flash limiter envelope, shock rings
    run.updateWarp(now);
    renderer.timeScale = capture.frozen ? 0 : run.phase === 'running' ? run.warpFactor : 1;
    fx.comfort = settings.comfort;
    fx.matterOn = run.phase === 'running' && run.matterMode !== null; // R4 (M4): real Matter water replaces FISHBOWL's cosmetic burst
    fx.frame(dt);
    futureFrame(dt); // R5 (M5)
    fx.setBeams(run.phase === 'running' ? run.beams : NO_BEAMS, dt); // G3: LANCE / TORCH / TRIPWIRE / MIRROR beams
    if (!taaUrl && !capture.ownsQuality) renderer.upscale = settings.graphics.renderScale < 0.99 ? settings.graphics.renderScale : 0;
    renderer.setCamera(eye, shot.target, shot.fov);
    if (run.phase !== lastPhase) {
      audio.setMode(run.phase);
      audio.ui(run.phase === 'countdown' ? 'countdown' : run.phase === 'running' ? 'go' : 'stop');
      // audio: gutters, tubes and glidepath rails give rolling balls their own layer
      if (run.phase === 'running' && net.store) audio.setPaths([...net.store.doc.links.values()].filter((l) => /tube|gutter|glide/.test(l.kind)).map((l) => ({ kind: l.kind, pts: l.points.map((q) => q.map(posToMetres) as V3) })));
      // AUDIO (beta, D127): GRAV WELL mode, FORCE WALL size and RIFT pair colour pick their sounds
      if (run.phase === 'running' && net.store) audio.setPartProps([...net.store.doc.parts.values()].filter((p) => AUDIO_PROP_TYPES.has(p.type)).map((p) => { const d = partDef(p.type); return { id: p.id, type: p.type, props: d ? propValues(d, p.props) : {} }; }));
      // Stop is a perfect reset: smoke, sparks and scorch marks go with it
      if (run.phase === 'build') fx.clear(); // G3: particles, volumes, debris rubble, shock rings
      // BETA (camera): leaving the editor remembers its view; Stop returns to it (cameras.ts markBuild / restoreBuild)
      if (lastPhase === 'build' && run.phase !== 'build') camRig.markBuild();
      if (lastPhase !== 'build' && run.phase === 'build') camRig.restoreBuild();
      lastPhase = run.phase;
      lastPos.clear();
    }
    audio.setListener({ pos: eye, forward: norm3([shot.target[0] - eye[0], shot.target[1] - eye[1], shot.target[2] - eye[2]]), up: [0, 1, 0] });
    audio.frame(dt);
    audio.setPlayback(run.paused || run.waiting, run.speed, run.tick); // audio: loops respect pause/scrub
    audio.setEnvironment(net.store?.doc.env.environment ?? 'studio', net.store?.doc.env.preset ?? 'room', net.store?.doc.env.air, net.store?.doc.env.zones); // audio: room tone (AUDIO §9); audio (M5): air 0 % = suit-radio sound; AUDIO (beta, D127): zero-g ring drones follow env.zones
    audioMochiCheck(now); // audio (M3): Tinker Lab ambient MOCHI purr
    if (run.phase === 'running' && run.bodies.length && !partIndex.size) indexRun();
    if (run.phase !== 'running' && partIndex.size) { partIndex.clear(); bodyIndex.clear(); }
    kb.frame(); // U4: the keyboard cursor steers the pointer before the pick
    pick();
    lastEye = eye;
    mover.frame(); // DRAG (D117): the dragged parts follow the pick
    // soft lock (MULTIPLAYER §5.4): the selected part is ours until deselected; refreshed so the
    // host's 10 s idle release doesn't drop it while the Inspector is open
    if (selectedId !== heldLock || (heldLock !== null && now - lockAt > 5000)) {
      if (heldLock !== null && heldLock !== selectedId) net.send(['unlock', { ids: [heldLock] }]);
      if (selectedId !== null && run.phase === 'build') { net.send(['lock', { ids: [selectedId] }]); lockAt = now; }
      heldLock = run.phase === 'build' ? selectedId : null;
    }
    if (net.store !== hookedStore) {
      hookedStore = net.store;
      hookedStore?.on(() => { sceneDirty = true; });
      sceneDirty = true;
    }

    // Scene: rebuilt when the doc, locks, run phase or part states (lit, pressed, dead…) change.
    const key = `${run.phase}:${run.runId}:${run.bodies.length}:${run.flags.join('')}:${run.meters.join(',')}:${poolKey()}`;
    if (sceneDirty || key !== sceneKey) { rebuildScene(); sceneKey = key; sceneDirty = false; }
    if (run.phase === 'running' && run.transforms !== lastTransforms) {
      lastTransforms = run.transforms;
      renderer.setBodyTransforms(run.transforms);
    }
    renderer.runMode = run.phase === 'running' && run.transforms.length > 0;
    const hoverIdx = run.phase === 'build' && hover?.part ? instancesOf.get(hover.part.id)?.[0] ?? -1 : -1;
    renderer.hover = tool === 'wire' || clean ? -1 : hoverIdx;
    renderer.hoverColor = PLAYER_RGB[net.me?.slot ?? 1]!;
    renderer.cursor = run.phase === 'build' && hover && !clean ? hover.point : null;

    const overlay: SceneItem[] = [];
    const doc = net.store?.doc;
    // links
    if (doc) {
      const linkIdx = new Map(run.linkIds.map((id, i) => [id, i]));
      const draws: LinkDraw[] = [];
      for (const l of doc.links.values()) {
        const end = (e: LinkRecord['from']): V3 | null => {
          if (!e) return null;
          const p = doc.parts.get(e.part);
          const def = p ? partDef(p.type) : undefined;
          const port = def?.ports[e.port];
          return p && def && port ? portWorld(def, port, poseOf, p.id) : null;
        };
        const a = end(l.from), b = end(l.to);
        if (!a || !b) continue;
        const li = linkIdx.get(l.id);
        draws.push({ link: l, a, b, state: run.phase === 'running' && li !== undefined ? Array.from(run.links.subarray(li * 4, li * 4 + 4)) : null });
      }
      const fronts: V3[] = [];
      linkItems(draws, overlay, fronts);
      fronts.forEach((f, i) => { fx.fuseSparks(f, dt); renderer.light(f, [1.2, 0.7, 0.3], 0.6); audio.loop(`fuse:${i}`, 'fuse', f, 1); });
    }
    // tubes (glass: translucent overlay; their colliders are static in the sim)
    if (doc) {
      for (const l of doc.links.values()) {
        gutters.items(l, overlay); // stream C: GUTTER profile sweep + kit pieces (gfx/gutter.ts)
        glidepaths.items(l, overlay); // G3: GLIDEPATH rail sweep + kit (gfx/glidepath.ts)
        if (l.kind !== 'tube' && l.kind !== 'tube_slim') continue;
        tubeItems(renderer, l.points.map((q) => q.map(posToMetres) as V3), l.kind === 'tube_slim', overlay);
      }
    }
    if (run.phase === 'build' && tool === 'path' && pathPts.length) {
      const pts = hover ? [...pathPts, [hover.point[0], hover.point[1] + (pathKind === 'tube' ? 0.15 : 0.06), hover.point[2]] as V3] : pathPts;
      // the preview changes every frame: draw it as segments rather than building meshes
      const path = roundPath(pts as [number, number, number][], pathKind === 'tube_slim' ? 0.12 : 0.3);
      for (let i = 1; i < path.length; i++) {
        const sg = segmentItem(path[i - 1]! as V3, path[i]! as V3, pathKind === 'tube_slim' ? 0.12 : 0.3, PLAYER_RGB[net.me?.slot ?? 1]!);
        if (sg) overlay.push({ ...sg, alpha: 0.18 });
      }
    }
    if (run.phase === 'build' && workY > 0 && !clean) {
      overlay.push({ pos: [cam.target[0], workY - 0.001, cam.target[2]], size: [6, 0.002, 6], mesh: 0, color: CHANNEL_RGB.impact, alpha: 0.08 });
    }
    // pings: a beacon in the pinger's colour for 3 s
    for (let i = pings.length - 1; i >= 0; i--) {
      const g = pings[i]!;
      if (now > g.until) { pings.splice(i, 1); continue; }
      if (clean) continue; // C4
      const c = PLAYER_RGB[g.by] ?? PLAYER_RGB[1]!;
      overlay.push({ pos: [g.pos[0], g.pos[1] + 0.35, g.pos[2]], size: [0.012, 0.7, 0.012], mesh: 2, color: c, emissive: 0.7 });
      overlay.push({ pos: [g.pos[0], g.pos[1] + 0.72, g.pos[2]], size: [0.06, 0.06, 0.06], mesh: 1, color: c, emissive: 0.9 });
    }
    // ghost trails of the last run
    if (run.phase === 'running' && doc) {
      const t = Math.floor(run.tick / 12);
      if (t !== trailTick) {
        trailTick = t;
        if (run.tick < 1) trailRec.clear();
        run.bodies.forEach((b, bi) => {
          if (b.role !== 'base' || partDef(b.type)?.body.kind !== 'dynamic') return;
          const o = bi * 7;
          const list = trailRec.get(bi) ?? [];
          const pnt: V3 = [run.transforms[o]!, run.transforms[o + 1]!, run.transforms[o + 2]!];
          const last = list.at(-1);
          if (!last || Math.hypot(pnt[0] - last[0], pnt[1] - last[1], pnt[2] - last[2]) > 0.03) list.push(pnt);
          if (list.length > 300) list.shift();
          trailRec.set(bi, list);
        });
      }
    } else if (trailRec.size) {
      trails = [...trailRec.values()].filter((l) => l.length > 2);
      trailRec.clear();
      trailTick = -1;
    }
    if (run.phase === 'build' && !clean) {
      for (const tr of trails) for (let i = 1; i < tr.length; i++) {
        const s = segmentItem(tr[i - 1]!, tr[i]!, 0.004 + 0.002 * cam.dist, PLAYER_RGB[net.me?.slot ?? 1]!);
        if (s) overlay.push({ ...s, emissive: 0.25, alpha: 0.3 + 0.4 * (i / tr.length) });
      }
    }
    // running parts: lit wicks glow, armed bangsticks fizz at the stub, burning planks flame, faults blink,
    // active ports light up in their channel colour (port-ring LEDs, RENDERING §6.1)
    if (run.phase === 'running' && doc) {
      run.partIds.forEach((id, i) => {
        const f = run.flags[i] ?? 0;
        const p = doc.parts.get(id);
        if (!p || f & PartFlagBits.dead) return;
        const def = partDef(p.type);
        if (!def) return;
        if (p.type === 'plank' && f & PartFlagBits.lit && !(f & PartFlagBits.broken)) {
          const pose = poseOf(id, 'base');
          if (pose) for (const z of [-0.35, 0, 0.35]) fx.flame(compose(pose, [0, 0.06, z]).pos, dt);
        }
        if (f & PartFlagBits.fault && Math.floor(now / 250) % 2 === 0) {
          const pose = poseOf(id, 'base');
          if (pose) overlay.push({ pos: compose(pose, [0, def.bounds.max[1] + 0.03, 0]).pos, size: [0.03, 0.03, 0.03], mesh: 1, color: CHANNEL_RGB.impact, emissive: 1, rough: 0.3, outline: null, alpha: 1 });
        }
        const flashed = now - (signalFlash.get(id) ?? -1e9) < 300;
        def.ports.forEach((port) => {
          const on = (port.channel === 'power' && f & PartFlagBits.powered) || (port.channel === 'heat' && f & PartFlagBits.lit) || (port.channel === 'signal' && flashed);
          if (!on) return;
          const w = portWorld(def, port, poseOf, id);
          if (w) overlay.push({ pos: w, size: [0.02, 0.02, 0.02], mesh: 1, color: CHANNEL_RGB[port.channel], emissive: 1 });
        });
      });
      const critBytes = (run as unknown as { critters?: Uint8Array }).critters; // audio: [clip, flags, emote, fsm] per part
      run.partIds.forEach((id, i) => {
        const f = run.flags[i] ?? 0;
        const p = doc.parts.get(id);
        if (!p || f & PartFlagBits.dead) return;
        if (p.type === 'wick' && f & PartFlagBits.lit) {
          const pose = poseOf(id, 'base');
          if (pose) { const fp = compose(pose, [0, 0.2, 0]).pos; renderer.light(fp, [1.1, 0.62, 0.25], 0.8); audio.loop(`flame:${id}`, 'flame', fp, 0.6); }
        }
        if ((p.type === 'motor' || p.type === 'gale') && f & PartFlagBits.powered) {
          const pose = poseOf(id, 'base');
          if (pose) audio.loop(`${p.type}:${id}`, p.type === 'motor' ? 'motor' : 'fan', pose.pos, 1);
        }
        if (p.type === 'bangstick' && f & PartFlagBits.armed) {
          const pose = poseOf(id, 'base');
          if (pose) fx.fuseSparks(compose(pose, [0.155, 0.045, 0]).pos, dt);
        }
        // audio (stream F): M2 part state loops and critter voices/footsteps; run.critters is contract 3 (stream B)
        const ap = poseOf(id, 'base');
        // audio (M3): the moving body's rotation (ω) and position (lift, ram, rack); audio (M5): GRABBER's gripper link (its last
        // 'piece' body, A5's kinematic links) for the servo whine
        const gi = p.type === 'grabber' ? bodyIndex.get(`${id}:piece`) : undefined;
        const arm = !ap ? null : gi !== undefined && run.transforms.length >= gi * 7 + 7
          ? { pos: [run.transforms[gi * 7]!, run.transforms[gi * 7 + 1]!, run.transforms[gi * 7 + 2]!] as V3, rot: [run.transforms[gi * 7 + 3]!, run.transforms[gi * 7 + 4]!, run.transforms[gi * 7 + 5]!, run.transforms[gi * 7 + 6]!] as [number, number, number, number] }
          : poseOf(id, 'arm');
        if (ap) audio.part(id, p.type, ap.pos, f, run.meters[i] ?? 0, arm?.rot ?? null, critBytes ? critBytes.subarray(i * 4, i * 4 + 4) : null, arm?.pos ?? null);
      });
    }
    // rolling: round dynamic parts (AUDIO §3); audio picks the surface layer (floor, gutter, tube, vortex)
    if (run.phase === 'running' && doc && dt > 0 && !run.paused) {
      run.bodies.forEach((b, bi) => {
        if (b.role !== 'base' || !ROLLERS.has(b.type)) return;
        const o = bi * 7;
        audio.roller(`roll:${bi}`, b.type, [run.transforms[o]!, run.transforms[o + 1]!, run.transforms[o + 2]!]);
      });
    }
    // ports (wire tool, or the hovered part) and the wire being drawn
    if (run.phase === 'build' && doc && !clean) {
      for (const p of doc.parts.values()) {
        const def = partDef(p.type);
        if (!def?.ports.length) continue;
        if (tool !== 'wire' && hover?.part?.id !== p.id && selectedId !== p.id && renderer.xrayMode === 'off') continue; // x-ray shows every port (stream C)
        const hl = hoverPort?.part.id === p.id ? hoverPort.port.name : wireFrom?.part.id === p.id ? wireFrom.port.name : null;
        portItems(def, p.id, poseOf, overlay, hl, net.me?.slot ?? 1);
      }
      if (wireFrom && hover) {
        const to = hoverPort?.world ?? hover.point;
        const ok = hoverPort && hoverPort.port.channel === wireFrom.port.channel;
        linkItems([{ link: { id: 0, kind: 'cable_signal', from: null, to: null, via: [], points: [], length: 0 }, a: wireFrom.world, b: to as V3, state: null }], overlay, []);
        overlay.push({ pos: to as V3, size: [0.02, 0.02, 0.02], mesh: 1, color: ok ? CHANNEL_RGB[wireFrom.port.channel] : DANGER_RGB, emissive: 0.8 });
      }
    }
    // the placement ghost
    placeSnap = null; // BUILDUX (D124)
    if (run.phase === 'build' && tool === 'place' && !drag && !clean && !mover.carrying) {
      const pose = ghostPose(false);
      if (pose) {
        const def = partDef(selectedType)!;
        const blocked = blockedBy(def, pose) !== null;
        const tint = blocked ? DANGER_RGB : PLAYER_RGB[net.me?.slot ?? 1]!;
        ghostOf(def, { id: 0, type: def.type, pos: [0, 0, 0], rot: { tag: 0 }, flags: 0 }, pose, tint, blocked, overlay);
        portSnapItems(overlay, placeSnap, now); // BUILDUX (D124): compatible ports glow, the joined one pulses
      }
    }
    // DRAG (D117): parts being moved (drag-to-move or a gizmo handle) as placement ghosts at the drop spot, red when the
    // drop would be refused; their links re-route through poseOf. A gizmo resize previews the same way.
    const mv = run.phase === 'build' ? moving() : null;
    if (mv && !clean) {
      const blocked = mv.refusal() !== null && mv.changed();
      const tint = blocked ? DANGER_RGB : PLAYER_RGB[net.me?.slot ?? 1]!;
      for (const m of mv.parts) { const pz = mv.pose(m.rec.id); if (pz) ghostOf(m.def, m.rec, pz, tint, blocked, overlay); }
      // a height stalk from the grabbed part down to the floor, so a lift (an ANCHOR at 2.5 m) reads at a glance
      const ap = mv.pose(mv.anchor.rec.id), fl = moveHost.floor();
      if (ap && fl !== null) {
        const lb = ap.pos[1] + mv.localMinY(mv.anchor, ap.rotation);
        const st = lb > fl + 0.03 ? segmentItem([ap.pos[0], fl, ap.pos[2]], [ap.pos[0], lb, ap.pos[2]], 0.004 + 0.0012 * cam.dist, tint) : null;
        if (st) { overlay.push({ ...st, alpha: 0.6 }); overlay.push({ pos: [ap.pos[0], fl + 0.002, ap.pos[2]], size: [0.1, 0.003, 0.1], mesh: 2, color: tint, alpha: 0.45 }); }
      }
      for (const l of mv.links) {
        if (l.from || l.to) continue; // port-to-port links follow their ends
        const pts = mv.linkPoints(l);
        for (let i = 1; i < pts.length; i++) { const sg = segmentItem(pts[i - 1]!, pts[i]!, l.kind === 'tube_slim' ? 0.12 : 0.3, tint); if (sg) overlay.push({ ...sg, alpha: 0.2 }); }
      }
      linkItems(ghostLinkDraws(mv, clipTool.ghostLinks(mv)), overlay, []); // BUILDUX (D123): a paste ghost's own cables and LINEs
      portSnapItems(overlay, mv.portSnap, now); // BUILDUX (D124)
    }
    const rz = run.phase === 'build' && !clean ? gizmo.resizePreview() : null;
    if (rz) ghostOf(rz.def, rz.rec, rz.pose, PLAYER_RGB[net.me?.slot ?? 1]!, false, overlay);
    if (partner && !clean) {
      const [x, y, z] = partner.cam;
      overlay.push({ pos: [x, y, z], size: [0.12, 0.05, 0.12], mesh: 0, color: PLAYER_RGB[partner.by]!, emissive: 0.15, rough: 0.3, bevel: true });
      // DRAG (D117): the parts the partner is holding, as ghosts in their colour (presence `ghost`, 20 Hz); BUILDUX (D124): turned, the whole held set
      if (run.phase === 'build') for (const g of decodeGhost(partner.ghost)) {
        const gd = partDef(g.type);
        if (gd) ghostOf(gd, { id: 0, type: gd.type, pos: [0, 0, 0], rot: { tag: 0 }, flags: 0 }, { pos: g.pos, rot: g.rot }, PLAYER_RGB[partner.by]!, false, overlay);
      }
    }
    // S3 Backlot: the terrain replaces the floor and the cove (U3 wiring); set() is a no-op unless the doc's terrain changed
    terrainView.set(net.store?.doc.activeTerrain() ?? null, net.store?.doc.terrainRev ?? 0);
    renderer.drawFloor = !terrainView.active;
    envView.players = net.partner() ? 2 : 1; // R5 (M5): the Hangar's zero-g rings go dashed white with two players
    envView.zonesOn = (net.store?.doc.env as { zones?: boolean } | undefined)?.zones !== false;
    const cv = envView.items(net.store?.doc.env, overlay) || terrainView.active ? null : coveItem(); // stream C: MEGA KITCHEN replaces the Studio cove
    if (cv) {
      overlay.push(cv);
      // four Ignition "T" camera marks at the neutral zone's corners (environments.md §1.1)
      const zone = NEUTRAL[net.store?.doc.env.preset ?? 'room'];
      if (zone) for (const [x, z] of [[zone[0], zone[1]], [zone[2], zone[1]], [zone[0], zone[3]], [zone[2], zone[3]]] as const) {
        overlay.push({ pos: [x, 0.0015, z], size: [0.15, 0.002, 0.02], mesh: 0, color: IGNITION_RGB, rough: 0.6 });
        overlay.push({ pos: [x, 0.0015, z + 0.065], size: [0.02, 0.002, 0.13], mesh: 0, color: IGNITION_RGB, rough: 0.6 });
      }
    }
    tools.frame(overlay); // section box, module ghost, selection sync, end-of-run Cascade Report (stream D)
    if (!clean) gizmo.frame(overlay); // DRAG (D117): the transform gizmo (on top) and its hovered handle
    toolBadge.show(mover.badge() ?? gizmo.badge() ?? boxSel.badge()); // DRAG (D117): height / Δ readout, or why the drop is refused; BUILDUX: marquee count
    camRig.overlay(overlay); // stream C: overview heat markers
    critters.frame(dt, net.store?.doc.parts.values(), run, overlay); // stream C: skinned critters (contract 3)
    grabberTurrets(overlay); // R5 (M5)
    partMorphs.frame(renderer, dt, run, net.store?.doc.parts, overlay); // stream C: part shape keys (+ GOTCHA spring fallback)
    renderer.setOverlay(overlay);
    // R4 (M4): container contents from Machine.partFill in the keyframes (run.fill, 0–1 in partIds order) or the build default
    const runFill = run.phase === 'running' && run.fill.length ? run.fill : null;
    matter.setFills(containerFills.items(containerParts, poseOf,
      (id) => { const i = runFill ? partIndex.get(id) : undefined; return i !== undefined && runFill ? runFill[i]! : null; },
      (id) => { const i = run.phase === 'running' ? partIndex.get(id) : undefined; return i !== undefined && ((run.flags[i] ?? 0) & PartFlagBits.broken) !== 0; }));
    renderer.draw();
    runBar.update();
    ui.updateOverlay(renderer, partner, net);
    ui.setRunState(run, now);
    ui.setHud(hover, net, renderer);
    if (perfHud) ui.setPerf(renderer, run);

    if (net.me) {
      // DRAG (D117): while a part is dragged (or moved with the gizmo) the partner sees it held: presence `ghost`
      // BUILDUX (D124): with its rotation and up to 32 held parts (a selection, a paste ghost), grabbed part first
      const held = mv ? [mv.anchor, ...mv.parts.filter((m) => m !== mv.anchor)].slice(0, 32).flatMap((m) => { const pz = mv.pose(m.rec.id); return pz ? [{ type: m.rec.type, pos: pz.pos, rot: pz.rot }] : []; }) : [];
      const enc = encodeGhost(held);
      const ghost = enc ? { ghost: enc } : {};
      net.presence(['presence', { cam: [eye[0], eye[1], eye[2], 0, 0, 0, 1], tool, ...(hover ? { cursor: hover.point } : {}), ...ghost }]);
    }
    capture.frame(); // C4: photo grid follows the canvas
    if (!external) schedule(); // C4: frames drawn by a capture don't start another loop
  }
  // ?debug keeps rendering at ~20 fps when the page isn't composited (automation, background panes)
  const debugTimer = new URLSearchParams(location.search).has('debug');
  function schedule(): void {
    let done = false;
    const go = (): void => { if (!done) { done = true; frame(); } };
    requestAnimationFrame(go);
    if (debugTimer) setTimeout(go, 50);
  }

  schedule();
  window.addEventListener('resize', () => renderer.resize());
  // beta: the title screen; Play now joins the session (the same host and world as before)
  showTitle(() => net.connect());
}

function eulerOf(r: Rotation): { yaw: number; pitch: number; roll: number } {
  if (r.tag === 1) return { yaw: r.yaw / 2, pitch: r.pitch / 2, roll: r.roll / 2 };
  return { yaw: 0, pitch: 0, roll: 0 };
}

// ---- DOM UI: the Glass Lab HUD lives in ui/hud.ts (stream U3) ------------------------------------------

function showBlocker(title: string, body: string): void {
  hideSplash(); // beta: a failed start replaces the loading screen
  const d = document.createElement('div');
  d.className = 'fullscreen-msg';
  d.innerHTML = '<div class="card"><h1></h1><p></p><p><a href="/check" style="color:var(--kn-beam)">Open /check</a></p></div>';
  d.querySelector('h1')!.textContent = title;
  d.querySelector('p')!.textContent = body;
  document.body.appendChild(d);
}

void posToMetres;
void boot().catch((err: unknown) => showBlocker('Something went wrong', String(err)));

const GLASS: readonly [number, number, number] = [0.75, 0.9, 1.0];

const tubeMeshes = new Map<string, number>();
/** A glass TUBE run (frame.md): one swept translucent mesh along its rounded path, cached per shape. */
function tubeItems(renderer: Renderer, pts: readonly V3[], slim: boolean, out: SceneItem[], tint: readonly [number, number, number] = GLASS): void {
  if (pts.length < 2) return;
  const key = `${slim ? 's' : 'w'}:${pts.map((p) => p.map((x) => x.toFixed(3)).join(',')).join(';')}`;
  let mesh = tubeMeshes.get(key);
  if (mesh === undefined) {
    const path = roundPath(pts as [number, number, number][], slim ? 0.12 : 0.3, 10);
    mesh = renderer.addMesh(`tube:${tubeMeshes.size}`, [sweptTube(path, slim ? 0.06 : 0.15)]);
    tubeMeshes.set(key, mesh);
  }
  out.push({ pos: [0, 0, 0], size: [1, 1, 1], mesh, color: tint, glass: true, rough: 0.05 }); // stream C: transmission pass
}

function segmentItem(a: V3, b: V3, thick: number, color: readonly [number, number, number]): SceneItem | null {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-4) return null;
  const y = [d[0] / len, d[1] / len, d[2] / len];
  const q: [number, number, number, number] = y[1]! < -0.9999 ? [1, 0, 0, 0] : (() => { const s2 = Math.sqrt((1 + y[1]!) * 2); return [y[2]! / s2, 0, -y[0]! / s2, s2 / 2] as [number, number, number, number]; })();
  return { pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], rot: q, size: [thick, len * 1.02, thick], mesh: 2, color, rough: 0.6 };
}

const norm3 = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

const IGNITION_RGB = hexLin('#FF5B2E');
/** Neutral zones per Studio preset (engine x0, z0, x1, z1; environments.md §1.2). */
const NEUTRAL: Record<string, readonly [number, number, number, number]> = {
  desk: [-2, -1.5, 2, 1.5], room: [-4, -3, 4, 5], warehouse: [-8, -4, 8, 12], arena: [-16, -8, 16, 24],
};
