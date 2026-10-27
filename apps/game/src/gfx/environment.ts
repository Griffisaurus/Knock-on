// Environments other than THE STUDIO (environments.md). M2: MEGA KITCHEN (contract 5), drawn when
// `doc.env.environment === 'kitchen'` from `/env/kitchen/kitchen.glb` (stream E's build), re-centred on
// the active preset: the set is authored in set coordinates and each preset's world origin sits on its
// `BOUNDS__<preset>` box (floor centre), or on the brief's numbers when the glb has no such node.
// Until the glb exists (or while it loads) the Studio stays up. The Studio is the default.
//
// M3 (L3, contract 2): THE TINKER LAB (`'tinker'`) from `/env/tinker/tinker.glb` (E3b) or, until that
// lands, the procedural stand-in built from the key art's layout (look/tinker.ts). Each set also brings
// its D79 look: the light rig, the set bake (IBL + set shadow), fog, grade and practical lamps
// (look/sets.ts), handed to the renderer's LookPass.

import { parseGlb, type GlbMesh, type ParsedGlb } from '@knockon/assets';
import * as partsData from '@knockon/parts-data';
import { ART_ENVS } from '../artlist.ts';
import { glbLods } from './glbmesh.ts';
import { dropColour, earthFrame, FAR_HIDDEN, FAR_LOD, FAR_TINT, farLod } from './setpieces.ts'; // RENDER (beta polish, D126)
import { KITCHEN_SET, studioSet, TINKER_LIGHT, TINKER_SET, type SetLook } from './look/sets.ts';
import { HANGAR_LIGHT, HANGAR_SET as HANGAR_LOOK, MOON_LIGHT, MOON_SET as MOON_LOOK } from './look/sets.ts'; // W5 (M5)
import { spaceStandIn } from './look/space.ts'; // W5 (M5): ORBITAL HANGAR / MOON BASE stand-ins until E5c's glbs land
import type { Practical } from './look/practicals.ts';
import { texSetsOf } from './look/textures.ts'; // E5c (M5): an environment's texture set (the backdrop Earth)
import type { MaterialLook } from './look/materials.ts'; // E5c (M5)
import { tinkerStandIn } from './look/tinker.ts';
import { KITCHEN_MORNING, type Renderer, type SceneItem, type StudioLook } from './renderer.ts';

type V3 = [number, number, number];

/** Brief §2 (set coordinates → engine Y-up, front +Z): Room origin = set (0, +24, 0) → engine z + 24. */
const KITCHEN_FALLBACK: Readonly<Record<string, V3>> = { room: [0, 0, 24], warehouse: [0, 0, 0] };
/**
 * Tinker Lab (D82: real scale, the key art's layout): the stand-in's origin is the mat top. Desk builds on
 * the mat; Room builds on the floor in front of the bench (the set is pushed back and up by the bench height).
 */
const TINKER_FALLBACK: Readonly<Record<string, V3>> = { desk: [0, 0, 0], room: [0, 0.904, -2.6] };

/** GI albedo (display sRGB) of a set collider by its physics material: oak for wood, a warm grey otherwise. */
const STATIC_ALBEDO: Readonly<Record<string, readonly number[]>> = { wood: [0.62, 0.42, 0.26], steel: [0.6, 0.6, 0.62], glass: [0.8, 0.85, 0.85] };

/**
 * The set's static colliders for the GI's SDF (preset world coordinates, the sim's own boxes), and its floor
 * height: the top of the box named `floor`. Null for a set without generated collider data.
 */
function setStatics(id: string, preset: string): { boxes: { center: readonly number[]; half: readonly number[]; albedo: readonly number[] }[]; floorY: number } | null {
  // W5 (M5): the space sets (deck / apron top at y = 0; the Moon's regolith is the heightfield, not in the SDF)
  if (id === 'hangar' || id === 'moon') {
    const sp = partsData.spacePreset(id === 'hangar' ? partsData.HANGAR_SET : partsData.MOON_SET, preset);
    if (!sp) return null;
    return { boxes: sp.boxes.filter((b) => b.name !== 'deck' && !b.name.startsWith('apron') && !b.name.startsWith('wall_') && b.name !== 'ceiling')
      .map((b) => ({ center: b.center, half: b.half, albedo: STATIC_ALBEDO[b.phys] ?? [0.6, 0.57, 0.52] })), floorY: 0 };
  }
  const env = id === 'tinker' ? partsData.TINKER : id === 'kitchen' ? partsData.KITCHEN : null;
  const p = (env?.presets as Record<string, { boxes: readonly { name: string; center: readonly number[]; half: readonly number[]; phys: string }[] } | undefined> | undefined)?.[preset];
  if (!p) return null;
  const floor = p.boxes.find((b) => b.name === 'floor');
  return {
    boxes: p.boxes.filter((b) => b !== floor).map((b) => ({ center: b.center, half: b.half, albedo: STATIC_ALBEDO[b.phys] ?? [0.6, 0.57, 0.52] })),
    floorY: floor ? floor.center[1]! + floor.half[1]! : 0,
  };
}

/** Helper nodes (bounds, colliders, emitters, spawns) are data, not set dressing. */
const visible = (m: GlbMesh): boolean => !/^(BOUNDS__|COL__|EMIT__|SPAWN__|NEUTRAL__)/i.test(m.nodeName);

/** Environments this view can draw (ART_ENVS lists the built ones; the Tinker Lab has a stand-in). */
const ENVS = (): readonly string[] => [...new Set([...ART_ENVS, 'tinker', 'hangar', 'moon'])]; // W5 (M5): the space sets have stand-ins
/** W5 (M5): sets drawn per preset (each Hangar bay is its own glb; the Moon's stand-in differs per preset). */
const PER_PRESET: ReadonlySet<string> = new Set(['hangar', 'moon']);
const artKey = (id: string, preset: string): string => (PER_PRESET.has(id) ? `${id}:${preset}` : id);

/** A named camera from the set's `<id>.env.json` (preset world coordinates). */
export interface EnvCamera { readonly pos: V3; readonly target: V3; readonly fovYDeg: number; readonly focusM?: number; readonly fStop?: number }

interface EnvArt {
  mesh: number; glass: number; offsets: Map<string, V3>; refs: Map<string, number>; standIn: boolean; cameras: Map<string, Record<string, EnvCamera>>;
  /** Shadow casters without the set's `noShadow` nodes (window frames, cords, beams), or −1 = `mesh`. */
  casters: number;
  /** Set bounds in set coordinates (the Room preset's), for the set shadow map; null = the look's. */
  bounds: { min: V3; max: V3 } | null;
  /** Practical lamps per preset (preset world coordinates, `<id>.env.json`); absent = the look's stand-ins. */
  practicals: Map<string, Practical[]>;
  /** R5 (M5): the Hangar's zero-g floor ring LEDs, solid (one player) and dashed + glyphs (two players); −1 none. */
  rings?: { solid: number; mp: number };
  /** W5 (M5): a world-toggled light group (the Moon's "Base lights"): its lens meshes lit / unlit, and the indices of
   *  this preset's practicals it switches. */
  group?: { on: number; off: number; practicals: readonly number[] };
  /** RENDER (beta polish, D126): the runtime-lit backdrop Earth: its own mesh (centred on the planet), centre (set
   *  coordinates), spin and art-directed phase. */
  earth?: { mesh: number; center: V3; axis: V3; degPerMinute: number; phaseDeg?: number };
  /** RENDER (beta polish, D126): set pieces drawn with distance LODs (the Moon's solar arrays), one mesh per chunk. */
  far?: { mesh: number; center: V3; radius: number; lod: number }[];
}

/** RENDER (beta polish, D126): the env data's backdrop Earth (parts-data `EnvEarth`; `lighting: 'runtime'` since D128). */
interface EarthData {
  readonly center: readonly number[]; readonly spinAxis: readonly number[]; readonly degPerMinute: number;
  readonly lighting?: string; readonly phaseDeg?: number; readonly meshes: readonly string[];
}


const LOOKS: Readonly<Record<string, { light: StudioLook; set: SetLook }>> = {
  kitchen: { light: KITCHEN_MORNING, set: KITCHEN_SET },
  tinker: { light: TINKER_LIGHT, set: TINKER_SET },
  hangar: { light: HANGAR_LIGHT, set: HANGAR_LOOK }, // W5 (M5)
  moon: { light: MOON_LIGHT, set: MOON_LOOK },
};

export class EnvView {
  private readonly r: Renderer;
  private readonly arts = new Map<string, EnvArt | 'loading' | 'missing'>();
  private active = 'studio';
  private activeAt = '';

  constructor(renderer: Renderer) { this.r = renderer; }

  /** Whether `environment` is drawn by this view right now (else the caller draws the Studio). */
  drawn(environment: string | undefined, preset = 'room'): boolean {
    const a = this.arts.get(artKey(environment ?? 'studio', preset));
    return a !== undefined && typeof a !== 'string';
  }

  /** A named camera of the set for a preset ('default', 'hero', 'wide', 'lobby' in the Tinker Lab), or null. */
  camera(environment: string, preset: string, name: string): EnvCamera | null {
    const a = this.arts.get(artKey(environment, preset));
    return a !== undefined && typeof a !== 'string' ? a.cameras.get(preset)?.[name] ?? null : null;
  }

  /** True while the set is a procedural stand-in (the Tinker Lab before E3b's glb, the space sets before E5c's). */
  standIn(environment: string, preset = 'room'): boolean {
    const a = this.arts.get(artKey(environment, preset));
    return a !== undefined && typeof a !== 'string' && a.standIn;
  }

  /**
   * Appends the environment's set pieces for this frame; returns false (and restores the Studio look)
   * when the Studio should be drawn instead.
   */
  items(env: { environment: string; preset: string; baseLights?: boolean } | undefined, out: SceneItem[]): boolean {
    this.r.earth = null; // RENDER (beta polish, D126): set below when the set has a runtime-lit Earth
    const id = env?.environment ?? 'studio';
    if (!ENVS().includes(id)) return this.setActive('studio');
    const key = artKey(id, env?.preset ?? 'room'); // W5 (M5): per-preset sets
    const a = this.arts.get(key);
    if (a === undefined) { this.arts.set(key, 'loading'); void (PER_PRESET.has(id) ? this.loadSpace(id as 'hangar' | 'moon', env?.preset ?? 'room', key) : this.load(id)); }
    if (a === undefined || typeof a === 'string') return this.setActive('studio');
    const at = a.offsets.get(env?.preset ?? 'room') ?? a.offsets.get('room') ?? [0, 0, 0];
    this.baseLights = env?.baseLights === true; // W5 (M5): the Moon's "Base lights" world toggle (env.baseLights)
    this.setActive(id, a, at, env?.preset ?? 'room');
    // W5 (M5): main.ts sets drawFloor from the Backlot terrain every frame, before this call: a set brings its own floor,
    // so the Studio floor (coloured from the look's cyc) must stay off here too. It z-fought every set floor at y = 0 and
    // turned the Moon's apron black (its cyc is the black sky).
    this.r.drawFloor = false;
    out.push({ pos: at, size: [1, 1, 1], mesh: a.mesh, color: [1, 1, 1], rough: 0.6 });
    // the scale reference (plinth, stick, THUD) of the active preset only (environments.md §0.7)
    const ref = a.refs.get(env?.preset ?? 'room');
    if (ref !== undefined) out.push({ pos: at, size: [1, 1, 1], mesh: ref, color: [1, 1, 1], rough: 0.6 });
    if (a.glass >= 0) out.push({ pos: at, size: [1, 1, 1], mesh: a.glass, color: [1, 1, 1], glass: true });
    // R5 (M5): zero-g rings: solid Field colour solo, dashed white with glyphs in a two-player session; dim while zones are off
    const ring = a.rings ? (this.players >= 2 ? a.rings.mp : a.rings.solid) : -1;
    if (ring >= 0) { const k = this.zonesOn ? 1 : 0.12; out.push({ pos: at, size: [1, 1, 1], mesh: ring, color: [k, k, k], rough: 0.3 }); }
    // W5 (M5): the light group's lenses (the Moon's lander floods), lit while its world toggle is on
    const lens = a.group ? (this.baseLights ? a.group.on : a.group.off) : -1;
    if (lens >= 0) out.push({ pos: at, size: [1, 1, 1], mesh: lens, color: [1, 1, 1], rough: 0.3 });
    // RENDER (beta polish, D126): far-LOD set pieces (the Moon's solar arrays) by their distance in pixels
    for (const f of a.far ?? []) {
      const e = this.r.eye, c = [f.center[0] + at[0], f.center[1] + at[1], f.center[2] + at[2]];
      const dist = Math.max(0.1, Math.hypot(e[0] - c[0]!, e[1] - c[1]!, e[2] - c[2]!) - f.radius);
      f.lod = this.farLods ? farLod(dist, this.r.fovDeg, this.r.internalSize[1], this.r.lib.meshes[f.mesh]!.lods.length, f.lod) : 0;
      const k = f.lod > 0 ? FAR_TINT : 1;
      out.push({ pos: at, size: [1, 1, 1], mesh: f.mesh, color: [k, k, k], rough: 0.6, lod: f.lod });
    }
    // RENDER (beta polish, D126): the backdrop Earth, spinning, lit from the set's sun in fs_earth
    const ea = a.earth;
    if (ea) {
      const c: V3 = [ea.center[0] + at[0], ea.center[1] + at[1], ea.center[2] + at[2]];
      out.push({ pos: c, size: [1, 1, 1], mesh: ea.mesh, color: [1, 1, 1], earth: true });
      this.r.earth = earthFrame(ea, c, this.r.eye, this.r.keyDir, Date.now());
    }
    return true;
  }

  /** RENDER (beta polish, D126): debug and before/after shots: false = far-LOD pieces always at LOD0. */
  farLods = true;

  /** W5 (M5): the world's "Base lights" toggle (doc.env.baseLights), read from the env each frame in items(). */
  private baseLights = false;

  /** R5 (M5): players in the session (main.ts, from the net's player list) and the world's zero-g zones switch. */
  players = 1;
  zonesOn = true;

  private setActive(id: string, a?: EnvArt, at?: V3, preset = 'room'): boolean {
    const key = `${id}@${at?.join(',') ?? ''}@${preset}@${a?.group && this.baseLights ? 'lights' : ''}`; // W5 (M5): + the light group
    if (key !== this.activeAt) {
      this.activeAt = key;
      this.active = id;
      const L = LOOKS[id];
      this.r.envLook = L?.light ?? null;
      this.r.drawFloor = id === 'studio'; // the sets bring their own floors
      const lp = this.r.lookPass;
      if (lp) {
        if (L && a && at) {
          // the set's bake (IBL, set shadow) is in world space: move the probe and bounds with the preset offset
          // W5 (M5): each Hangar bay has its own baked IBL (E5c: ibl_hangar_<preset>, Cycles sun strength 6); not with the stand-in
          const s = id === 'hangar' && !a.standIn ? { ...L.set, iblFile: `/env/hangar/ibl_hangar_${preset}.json`, iblScale: (Math.PI * HANGAR_LIGHT.keyI) / 6 }
            : id === 'moon' && a.standIn ? (({ iblFile: _f, ...rest }) => rest)(L.set) : L.set;
          // the stand-in is authored in Desk coordinates (offset 0 for Desk); a built set in set coordinates
          const b = a.bounds ? { min: a.bounds.min.map((v, i) => v + at[i]!) as V3, max: a.bounds.max.map((v, i) => v + at[i]!) as V3 }
            : { min: [s.bounds.min[0] + at[0], s.bounds.min[1] + at[1], s.bounds.min[2] + at[2]] as V3, max: [s.bounds.max[0] + at[0], s.bounds.max[1] + at[1], s.bounds.max[2] + at[2]] as V3 };
          const moved: SetLook = { ...s, probe: [s.probe[0] + at[0], s.probe[1] + at[1], s.probe[2] + at[2]], bounds: b };
          lp.setEnvironment(moved, a.casters >= 0
            ? [{ mesh: a.mesh, offset: at, shadow: false }, { mesh: a.casters, offset: at, ibl: false }]
            : [{ mesh: a.mesh, offset: at }]);
          // practical lamps: E3b's spots for this preset, else the look's stand-ins (pointing down, centre one shadowed)
          // W5 (M5): a light group's practicals only while its toggle is on (the Moon's lander floods, off by default)
          const own = a.practicals.get(preset)?.filter((_, i) => !a.group || this.baseLights || !a.group.practicals.includes(i));
          lp.setPracticals(own ?? s.practicals.map((q, i): Practical => ({
            pos: [q.pos[0] + at[0], q.pos[1] + at[1], q.pos[2] + at[2]], dir: [0, -1, 0], color: [1, 0.78, 0.52],
            innerConeDeg: 45, outerConeDeg: 70, rangeM: 8, bulbRadiusM: 0.045, cyclesWatts: 70, shadowed: i === 1,
          })));
        } else {
          lp.setEnvironment(studioSet(this.r.look), []);
          lp.setPracticals([]);
        }
      }
      // GI (M3 close-out): the set's collider boxes join the SDF and the analytic floor moves to the set's floor
      const st = L && a && at ? setStatics(id, preset) : null;
      this.r.gi?.setStatic(st?.boxes ?? [], st?.floorY ?? 0);
    }
    return id !== 'studio';
  }

  private async load(id: string, space?: SpaceLoad): Promise<void> {
    const key = space?.key ?? id; // W5 (M5): per-preset space sets
    const missing = (): void => { if (space) space.fallback(); else if (id === 'tinker') this.standInTinker(); else this.arts.set(id, 'missing'); };
    try {
      const res = await fetch(space?.url ?? `/env/${id}/${id}.glb`);
      // the dev server answers unknown paths with index.html: only a real glb counts
      const isGlb = res.ok && !(res.headers.get('content-type') ?? '').includes('html');
      if (!isGlb) { missing(); return; }
      const glb = parseGlb(await res.arrayBuffer());
      const refOf = (m: GlbMesh): string | null => {
        for (let p = m.node; p !== -1; p = glb.nodes[p]!.parent) { const r = /^REF__scale__([a-z]+)/i.exec(glb.nodes[p]!.name); if (r) return r[1]!.toLowerCase(); }
        return null;
      };
      // set shadow flags (E3b): `__shadowonly` meshes cast but are never drawn (the cutaway's invisible roof),
      // `__noshadow` meshes are drawn but never cast (glazing bars, beams, pendants, the yard backdrop); the
      // generated table also lists both as name prefixes (tinker.env.json noShadow / shadowOnly)
      let noShadow: string[] = [], shadowOnlyList: string[] = [];
      let envJson: unknown = null; // E5c (M5): kept for its `textures` (texSetsOf)
      type Presets = Record<string, { origin: readonly number[]; bounds?: { min: V3; max: V3 }; cameras?: Record<string, EnvCamera>; practicals?: Practical[] }>;
      let presets = space ? space.presets as Presets : (id === 'kitchen' ? partsData.KITCHEN : (partsData as unknown as Record<string, { presets?: Presets } | undefined>)['TINKER'])?.presets as Presets | undefined;
      try {
        const ej = await fetch(`/env/${id}/${id}.env.json`);
        if (ej.ok && !(ej.headers.get('content-type') ?? '').includes('html')) {
          const j = (await ej.json()) as { presets?: Presets; noShadow?: string[]; shadowOnly?: string[] };
          envJson = j; // E5c (M5)
          if (!space) presets = j.presets ?? presets; // W5 (M5): the space sets' presets come from parts-data
          noShadow = j.noShadow ?? [];
          shadowOnlyList = j.shadowOnly ?? [];
        }
      } catch { /* the glb's BOUNDS__ nodes or the fallback stand */ }
      const flagged = (m: GlbMesh, suffix: string, list: readonly string[]): boolean => {
        for (let p = m.node; p !== -1; p = glb.nodes[p]!.parent) {
          const n = glb.nodes[p]!.name;
          if (n.endsWith(suffix)) return true;
          const bare = n.replace(/__(noshadow|shadowonly)$/, '').replace(/__L\d$/, '');
          if (list.some((x) => bare === x || bare.startsWith(x))) return true;
        }
        return m.meshName.endsWith(suffix);
      };
      const shadowOnly = (m: GlbMesh): boolean => flagged(m, '__shadowonly', shadowOnlyList);
      const shadowless = (m: GlbMesh): boolean => flagged(m, '__noshadow', noShadow);
      // overlays draw LOD0 only (the set is one always-drawn mesh; parentless helpers like BACKDROP are LOD0 too)
      // R5 (M5): the Hangar's zero-g floor rings: the solid Field-colour LED ring (one player) and the dashed white LEDs +
      // glyph decals (two players: Plasma is Player 2's colour; environments.md Hangar §5.2) are their own meshes
      const ringOf = (m: GlbMesh): 'solid' | 'mp' | null => {
        const n = m.nodeName.replace(/__L\d$/, '');
        return /_ring_led$/.test(n) ? 'solid' : /_ring_(led_dash|glyph)$/.test(n) ? 'mp' : null;
      };
      // W5 (M5): the space set's world-toggled light group (MOON.lightGroups.baseLights: the lander flood lenses)
      const grp = space?.group;
      const inGroup = (m: GlbMesh): boolean => !!grp && grp.meshes.some((x) => m.nodeName.replace(/__L\d$/, '').startsWith(x) || m.meshName.startsWith(x));
      // E5c (M5): the env's texture set (`<id>.env.json → textures`, files under /env/<id>/: the baked backdrop Earth) is
      // bound like a part's set; only materials flagged extras.texSet with UVs sample it (kn_env_earth_tex)
      let look: MaterialLook | undefined;
      const sets = texSetsOf(envJson);
      if (sets.length && this.r.lookPass) {
        try { const layer = await this.r.lookPass.tex.load(`env:${id}`, sets[0]!, `/env/${id}/`); if (layer >= 0) look = { layer: () => layer }; } catch { /* masters only */ }
      }
      // RENDER (beta polish, D126): a runtime-lit Earth (env data `lighting: 'runtime'`) is its own mesh, centred on the planet
      const earthData = space?.earth?.lighting === 'runtime' ? space.earth : undefined;
      const bareName = (m: GlbMesh): string => m.nodeName.replace(/__(noshadow|shadowonly)$/, '').replace(/__L\d$/, '');
      const isEarth = (m: GlbMesh): boolean => !!earthData && earthData.meshes.includes(bareName(m));
      // RENDER (beta polish, D126): far-LOD pieces by chunk (`…__c<n>`)
      const farChunk = (m: GlbMesh): string | null => (FAR_LOD.test(m.nodeName) ? /__c(\d+)/.exec(m.nodeName)?.[1] ?? '0' : null);
      const lods = glbLods(glb, 1, (m) => visible(m) && refOf(m) === null && !shadowOnly(m) && ringOf(m) === null && !inGroup(m) && !isEarth(m) && farChunk(m) === null, [], false, look);
      if (!lods.length) { missing(); return; }
      const ring = (kind: 'solid' | 'mp'): number => {
        const g = glbLods(glb, 1, (m) => visible(m) && ringOf(m) === kind);
        if (!g.length) return -1;
        // lit LEDs: the solid ring in the Field colour, the dashes in #EEF1F6 (the glyph decals keep their atlas)
        const rgb = kind === 'solid' ? [1, 0.047, 0.42] : [0.855, 0.88, 0.913];
        for (const geo of g) {
          const c = geo.colors!, mt = geo.mats!;
          for (let i = 0; i < c.length / 4; i++) {
            if (mt[i * 4 + 3]! < 0.3) continue; // decal texels (kind byte 64)
            c[i * 4] = rgb[0]!; c[i * 4 + 1] = rgb[1]!; c[i * 4 + 2] = rgb[2]!;
            mt[i * 4 + 2] = 0.3;
          }
        }
        return this.r.addMesh(`env:${key}:ring:${kind}`, g);
      };
      const rings = { solid: ring('solid'), mp: ring('mp') };
      // W5 (M5): the group's lens meshes twice: lit (5,000 K white, emissive) and unlit (as authored, no emission)
      const lensMesh = (lit: boolean): number => {
        // the lenses may be transmissive (drawn in the glass pass): then only the lit copy is extra, an opaque emissive disc
        let g = glbLods(glb, 1, (m) => visible(m) && inGroup(m));
        if (!g.length && lit) g = glbLods(glb, 1, (m) => visible(m) && inGroup(m), [], true);
        if (!g.length) return -1;
        for (const geo of g) {
          const c = geo.colors, mt = geo.mats;
          if (!c || !mt) continue;
          for (let i = 0; i < mt.length / 4; i++) {
            if (lit) { c[i * 4] = 1; c[i * 4 + 1] = 0.94; c[i * 4 + 2] = 0.86; mt[i * 4 + 2] = 0.8; } else mt[i * 4 + 2] = 0;
          }
        }
        return this.r.addMesh(`env:${key}:group:${lit ? 'on' : 'off'}`, g);
      };
      const group = grp ? { on: lensMesh(true), off: lensMesh(false), practicals: grp.practicals } : undefined;
      const far: NonNullable<EnvArt['far']> = [];
      for (const c of new Set(glb.meshes.map(farChunk).filter((x): x is string => x !== null))) {
        const g = glbLods(glb, 3, (m) => visible(m) && !shadowOnly(m) && farChunk(m) === c, [], false, look);
        if (!g.length) continue;
        // the far LOD keeps the cell slabs but not the backplate 7 cm behind them: at 150 m+ that's under the 24-bit depth
        // buffer's precision, so the two z-fight into stripes (the backplate is hidden behind the slabs anyway)
        const plate = glb.materials.find((m) => FAR_HIDDEN.test(m.name))?.baseColorFactor;
        if (plate && g.length > 1) g[g.length - 1] = dropColour(g[g.length - 1]!, plate);
        const id = this.r.addMesh(`env:${key}:far:${c}`, g);
        const info = this.r.lib.meshes[id]!;
        far.push({ mesh: id, center: [...info.center] as V3, radius: info.radius, lod: 0 });
      }
      let earth: EnvArt['earth'];
      if (earthData) {
        const g = glbLods(glb, 1, (m) => visible(m) && isEarth(m), [], false, look);
        const ec = earthData.center;
        for (const geo of g) for (let i = 0; i < geo.positions.length; i += 3) { geo.positions[i]! -= ec[0]!; geo.positions[i + 1]! -= ec[1]!; geo.positions[i + 2]! -= ec[2]!; }
        if (g.length) {
          earth = {
            mesh: this.r.addMesh(`env:${key}:earth`, g), center: [ec[0]!, ec[1]!, ec[2]!], axis: [earthData.spinAxis[0]!, earthData.spinAxis[1]!, earthData.spinAxis[2]!],
            degPerMinute: earthData.degPerMinute, ...(earthData.phaseDeg !== undefined ? { phaseDeg: earthData.phaseDeg } : {}),
          };
        }
      }
      const mesh = this.r.addMesh(`env:${key}`, lods);
      const glassLods = glbLods(glb, 1, (m) => visible(m) && !shadowOnly(m), [], true);
      const glass = glassLods.length ? this.r.addMesh(`env:${key}:glass`, glassLods, [], { glass: true }) : -1;
      const refs = new Map<string, number>();
      for (const p of new Set(glb.meshes.map(refOf).filter((x): x is string => x !== null))) {
        const g = glbLods(glb, 1, (m) => visible(m) && refOf(m) === p);
        if (g.length) refs.set(p, this.r.addMesh(`env:${key}:ref:${p}`, g));
      }
      // preset origins from the set's generated table (parts-data env_<set>.ts, or the `<id>.env.json` beside
      // the glb, which E3b writes from the same table): the set is drawn at −origin
      const offsets = presetOffsets(glb, id === 'tinker' ? TINKER_FALLBACK : KITCHEN_FALLBACK);
      // shadow casters: the set (and its shadow-only roof) minus the noShadow meshes (environments.md §0.9)
      // the BACKDROP (sky card, trees outside the windows) never casts: it would block the sun (key art: visible_shadow off)
      const backdrop = (m: GlbMesh): boolean => { for (let p = m.node; p !== -1; p = glb.nodes[p]!.parent) if (/^(BACKDROP|PROBES)/i.test(glb.nodes[p]!.name)) return true; return false; };
      const casterLods = glbLods(glb, 1, (m) => visible(m) && refOf(m) === null && (shadowOnly(m) || (!shadowless(m) && !backdrop(m))));
      const casters = casterLods.length ? this.r.addMesh(`env:${key}:casters`, casterLods) : -1;
      // the Room preset's bounds are in set coordinates (its origin is the set origin): the set shadow's extent
      const rb = presets?.['room']?.bounds;
      const ro = presets?.['room']?.origin ?? [0, 0, 0];
      const bounds = space ? space.bounds : rb ? { min: rb.min.map((v, i) => v + ro[i]! - 0.6) as V3, max: rb.max.map((v, i) => v + ro[i]! + 0.6) as V3 } : null;
      const cameras = new Map<string, Record<string, EnvCamera>>();
      const practicals = new Map<string, Practical[]>();
      if (presets) for (const [p, v] of Object.entries(presets)) {
        offsets.set(p, [-v.origin[0]!, -v.origin[1]!, -v.origin[2]!]);
        if (v.cameras) cameras.set(p, v.cameras);
        if (v.practicals?.length) practicals.set(p, v.practicals);
      }
      this.arts.set(key, { mesh, glass, offsets, refs, standIn: false, cameras, casters, bounds, practicals, rings, ...(group ? { group } : {}), ...(earth ? { earth } : {}), ...(far.length ? { far } : {}) });
    } catch (e) {
      console.warn(`environment ${key}:`, e);
      missing();
    }
  }

  /**
   * W5 (M5): ORBITAL HANGAR / MOON BASE. E5c's glb when it's built (the Hangar has one per bay), else W5's procedural
   * stand-in from the brief's layout (look/space.ts). Each preset is in set coordinates (origin 0), so the offset is 0.
   */
  private async loadSpace(id: 'hangar' | 'moon', preset: string, key: string): Promise<void> {
    const env = id === 'hangar' ? partsData.HANGAR_SET : partsData.MOON_SET;
    const sp = partsData.spacePreset(env, preset) ?? Object.values(env.presets)[0]!;
    const url = '/' + (sp.glb ?? env.glb ?? `env/${id}/${id}.glb`).replace(/^\/+/, '');
    const cameras = new Map<string, Record<string, EnvCamera>>([[preset, sp.cameras as unknown as Record<string, EnvCamera>]]);
    const bounds = spaceBounds(id, sp);
    // E5c's practicals (strips, sconces, floods) aren't in the renderer's spot format: the look's stand-ins light the bay
    // E5c's practicals are in the renderer's spot format (≤ 8, the first shadowed): the Tinker Lab's path
    const own = (sp as unknown as { practicals?: Practical[] }).practicals;
    const presets = { [preset]: { origin: sp.origin, cameras: sp.cameras, ...(own?.length ? { practicals: own } : {}) } };
    const group = id === 'moon' ? (env as unknown as { lightGroups?: { baseLights?: { practicals: readonly number[]; meshes: readonly string[] } } }).lightGroups?.baseLights : undefined;
    const earth = (sp as unknown as { earth?: EarthData }).earth; // RENDER (beta polish, D126)
    await this.load(id, {
      key, url, presets, bounds, ...(group ? { group } : {}), ...(earth ? { earth } : {}),
      fallback: () => {
        const mesh = this.r.addMesh(`env:${key}:standin`, [spaceStandIn(id, preset)]);
        this.arts.set(key, { mesh, glass: -1, offsets: new Map([[preset, [0, 0, 0]]]), refs: new Map(), standIn: true, cameras, casters: -1, bounds, practicals: new Map() });
      },
    });
  }

  private standInTinker(): void {
    const mesh = this.r.addMesh('env:tinker:standin', [tinkerStandIn()]);
    this.arts.set('tinker', { mesh, glass: -1, offsets: new Map(Object.entries(TINKER_FALLBACK).map(([k, v]) => [k, [...v] as V3])), refs: new Map(), standIn: true, cameras: new Map(), casters: -1, bounds: null, practicals: new Map() });
  }
}

/** W5 (M5): how `load` takes a per-preset space set: its art key and glb, the preset table, the shadow bounds, the stand-in. */
interface SpaceLoad {
  readonly key: string; readonly url: string; readonly bounds: { min: V3; max: V3 };
  readonly presets: Record<string, { origin: readonly number[]; cameras?: unknown; practicals?: Practical[] }>;
  /** The set's world-toggled light group (the Moon's "Base lights"), if any. */
  readonly group?: { readonly practicals: readonly number[]; readonly meshes: readonly string[] };
  /** RENDER (beta polish, D126): the preset's backdrop Earth (runtime-lit when `lighting` is 'runtime'). */
  readonly earth?: EarthData;
  readonly fallback: () => void;
}

/** W5 (M5): the set shadow's extent for a space set: the Hangar bay (walls and ceiling), or the Moon's central field. */
function spaceBounds(id: 'hangar' | 'moon', sp: partsData.SpacePreset): { min: V3; max: V3 } {
  if (id === 'moon') return { min: [-130, -1, -130], max: [130, 32, 130] };
  const w = sp.bounds.max[0] + 2, top = sp.bounds.max[1] + 4;
  return { min: [-w, -0.5, -w], max: [w, top, w] };
}

/** World offset per preset: minus the floor centre of its `BOUNDS__<preset>` node (mesh AABB or empty's origin). */
export function presetOffsets(glb: ParsedGlb, fallback: Readonly<Record<string, V3>>): Map<string, V3> {
  const out = new Map<string, V3>(Object.entries(fallback).map(([k, v]) => [k, [...v] as V3]));
  glb.nodes.forEach((n, i) => {
    const m = /^BOUNDS__([a-z]+)/i.exec(n.name);
    if (!m) return;
    const preset = m[1]!.toLowerCase();
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const mesh of glb.meshes) {
      if (mesh.node !== i) continue;
      for (const p of mesh.primitives) {
        for (let k = 0; k < p.positions.length; k++) { lo[k % 3] = Math.min(lo[k % 3]!, p.positions[k]!); hi[k % 3] = Math.max(hi[k % 3]!, p.positions[k]!); }
      }
    }
    if (Number.isFinite(lo[0]!)) out.set(preset, [-(lo[0]! + hi[0]!) / 2, -lo[1]!, -(lo[2]! + hi[2]!) / 2]);
    else out.set(preset, [-n.matrix[12]!, -n.matrix[13]!, -n.matrix[14]!]);
  });
  return out;
}
