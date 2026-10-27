// Types and strict parsers for the exporter's JSON sidecars (DATA_FORMATS §8.1, §8.2).
// All positions are engine Y-up metres relative to the part origin.
import type { Vec3, Vec4 } from './glb.ts';

export class AssetFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetFormatError';
  }
}

export const CHANNELS = ['impact', 'signal', 'spin', 'tension', 'power', 'light', 'heat', 'air', 'fluid', 'sound', 'lure', 'field'] as const;
export type Channel = (typeof CHANNELS)[number];
export type PortDir = 'in' | 'out' | 'both';
export type PortSize = 'S' | 'M' | 'L';
export type PartClass = 'S' | 'M' | 'L' | 'XL';
export const SHAPE_KINDS = ['sphere', 'box', 'capsule', 'cylinder', 'hull', 'mesh', 'wheel'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export interface ArtPort {
  name: string;
  channel: Channel;
  dir: PortDir;
  size: PortSize;
  pos: Vec3;
  dirVec: Vec3;
  maxLinks?: number;
  broadcast?: boolean;
  kind?: string;
}

export interface ArtSensor { name: string; kind: string; pos: Vec3; points: Vec3[]; threshold?: number; cooldown?: number }
export interface ArtEmitter { name: string; fx: string; pos: Vec3; dirVec: Vec3 }
export interface ArtPivot { name: string; pos: Vec3; rot: Vec4; axis: Vec3; min?: number; max?: number }
export interface ArtScreen { name: string; kind: string; pos: Vec3; size: Vec3; digits?: number; cells?: number; color?: string }
/** M4 (E4a): the container-fill pass data baked by kn_tools/cavity.py (ASSET_PIPELINE §3.10). `lut[i]` is the
 * level-plane height (engine y, part space) that encloses i / (lut.length - 1) of `volume` with the part upright;
 * `mesh` is the closed cavity (flat xyz + triangle indices) for clipping at any tilt; `tilt` repeats the LUT for a
 * pivot turned to each of `angles` (degrees). */
export interface ArtCavity {
  name: string;
  matter: string;
  capacity?: number;
  fill?: number;
  volume?: number;
  min?: Vec3;
  max?: Vec3;
  lut?: number[];
  mesh?: { vertices: number[]; indices: number[] };
  pivot?: string;
  tilt?: { pivot: string; axis: Vec3; origin: Vec3; angles: number[]; luts: number[][] };
}

/** M3 (E3c): the part's texture set (ASSET_PIPELINE §5.2), files next to the glb. Albedo is sRGB; normal (OpenGL
 * +Y, tangent space, TEXCOORD_0 + glb TANGENT) and ORM (R occlusion, G roughness, B metallic) are linear. */
export interface ArtTextures {
  albedo: string;
  normal: string;
  orm: string;
  /** Square size in texels (1024 or 2048). */
  size: number;
  set: string;
  format: string;
  /** Master ids the set covers (their glb materials carry extras.texSet). */
  slots: string[];
}

export interface ArtJson {
  type: string;
  version: number;
  class: PartClass;
  family: string;
  origin: string;
  /** Cells (0.1 m), w × h × d. */
  footprint: Vec3;
  bounds: { min: Vec3; max: Vec3 };
  ports: ArtPort[];
  sensors: ArtSensor[];
  emitters: ArtEmitter[];
  pivots: ArtPivot[];
  screens: ArtScreen[];
  cavities: ArtCavity[];
  ledGroups: { index: number; name: string }[];
  lods: { tris: number }[];
  clips: string[];
  skins: string[];
  massHint: number;
  materials: string[];
  hints: Record<string, number | boolean>;
  notes?: string;
  textures?: ArtTextures;
}

export interface ShapeBase {
  name: string;
  pos: Vec3;
  /** Quaternion x, y, z, w. */
  rot: Vec4;
  phys: string;
  restitution?: number;
  friction?: number;
  sharp?: boolean;
}

export type Shape =
  | (ShapeBase & { kind: 'sphere'; radius: number })
  | (ShapeBase & { kind: 'box'; halfExtents: Vec3; convexRadius: number })
  | (ShapeBase & { kind: 'capsule' | 'cylinder' | 'wheel'; radius: number; halfHeight: number })
  | (ShapeBase & { kind: 'hull'; points: Vec3[] })
  | (ShapeBase & { kind: 'mesh'; vertices: Vec3[]; indices: number[] });

export interface ShapesJson {
  type: string;
  shapes: Shape[];
}

// ---------------------------------------------------------------- field readers

type Rec = Record<string, unknown>;

function rec(v: unknown, path: string): Rec {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new AssetFormatError(`${path}: expected an object`);
  return v as Rec;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new AssetFormatError(`${path}: expected a string`);
  return v;
}

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new AssetFormatError(`${path}: expected a finite number`);
  return v;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new AssetFormatError(`${path}: expected one of ${allowed.join(', ')}`);
  }
  return v as T;
}

function list<T>(v: unknown, path: string, item: (x: unknown, p: string) => T): T[] {
  if (!Array.isArray(v)) throw new AssetFormatError(`${path}: expected an array`);
  return v.map((x, i) => item(x, `${path}[${i}]`));
}

function vec3(v: unknown, path: string): Vec3 {
  const a = list(v, path, num);
  if (a.length !== 3) throw new AssetFormatError(`${path}: expected 3 numbers`);
  return [a[0]!, a[1]!, a[2]!];
}

function vec4(v: unknown, path: string): Vec4 {
  const a = list(v, path, num);
  if (a.length !== 4) throw new AssetFormatError(`${path}: expected 4 numbers`);
  return [a[0]!, a[1]!, a[2]!, a[3]!];
}

function optNum(o: Rec, key: string, path: string): number | undefined {
  return o[key] === undefined ? undefined : num(o[key], `${path}.${key}`);
}

/** Copies only defined optionals, as exactOptionalPropertyTypes requires. */
function withOptional<T extends object>(base: T, extra: Record<string, unknown>): T {
  const out = Object.assign({}, base) as Record<string, unknown>;
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) out[k] = v;
  return out as T;
}

// ---------------------------------------------------------------- parsers

export function parseArtJson(input: unknown): ArtJson {
  const o = rec(input, 'art');
  const bounds = rec(o['bounds'], 'art.bounds');
  const lods = list(o['lods'], 'art.lods', (x, p) => ({ tris: num(rec(x, p)['tris'], `${p}.tris`) }));
  if (lods.length < 1 || lods.length > 4) throw new AssetFormatError('art.lods: expected 1-4 LODs');
  const hintsIn = o['hints'] === undefined ? {} : rec(o['hints'], 'art.hints');
  const hints: Record<string, number | boolean> = {};
  for (const [k, v] of Object.entries(hintsIn)) {
    if (typeof v !== 'number' && typeof v !== 'boolean') throw new AssetFormatError(`art.hints.${k}: expected number or boolean`);
    hints[k] = v;
  }
  const art: ArtJson = {
    type: str(o['type'], 'art.type'),
    version: num(o['version'], 'art.version'),
    class: oneOf(o['class'], ['S', 'M', 'L', 'XL'] as const, 'art.class'),
    family: str(o['family'], 'art.family'),
    origin: str(o['origin'], 'art.origin'),
    footprint: vec3(o['footprint'], 'art.footprint'),
    bounds: { min: vec3(bounds['min'], 'art.bounds.min'), max: vec3(bounds['max'], 'art.bounds.max') },
    ports: list(o['ports'], 'art.ports', (x, p) => {
      const r = rec(x, p);
      return withOptional<ArtPort>({
        name: str(r['name'], `${p}.name`),
        channel: oneOf(r['channel'], CHANNELS, `${p}.channel`),
        dir: oneOf(r['dir'], ['in', 'out', 'both'] as const, `${p}.dir`),
        size: oneOf(r['size'], ['S', 'M', 'L'] as const, `${p}.size`),
        pos: vec3(r['pos'], `${p}.pos`),
        dirVec: vec3(r['dirVec'], `${p}.dirVec`),
      }, {
        maxLinks: optNum(r, 'maxLinks', p),
        broadcast: r['broadcast'] === undefined ? undefined : r['broadcast'] === true,
        kind: r['kind'] === undefined ? undefined : str(r['kind'], `${p}.kind`),
      });
    }),
    sensors: list(o['sensors'], 'art.sensors', (x, p) => {
      const r = rec(x, p);
      return withOptional<ArtSensor>({
        name: str(r['name'], `${p}.name`), kind: str(r['kind'], `${p}.kind`), pos: vec3(r['pos'], `${p}.pos`),
        points: list(r['points'], `${p}.points`, vec3),
      }, { threshold: optNum(r, 'threshold', p), cooldown: optNum(r, 'cooldown', p) });
    }),
    emitters: list(o['emitters'], 'art.emitters', (x, p) => {
      const r = rec(x, p);
      return { name: str(r['name'], `${p}.name`), fx: str(r['fx'], `${p}.fx`), pos: vec3(r['pos'], `${p}.pos`),
        dirVec: vec3(r['dirVec'], `${p}.dirVec`) };
    }),
    pivots: list(o['pivots'], 'art.pivots', (x, p) => {
      const r = rec(x, p);
      return withOptional<ArtPivot>({
        name: str(r['name'], `${p}.name`), pos: vec3(r['pos'], `${p}.pos`), rot: vec4(r['rot'], `${p}.rot`),
        axis: vec3(r['axis'], `${p}.axis`),
      }, { min: optNum(r, 'min', p), max: optNum(r, 'max', p) });
    }),
    screens: list(o['screens'] ?? [], 'art.screens', (x, p) => {
      const r = rec(x, p);
      return withOptional<ArtScreen>({
        name: str(r['name'], `${p}.name`), kind: str(r['kind'], `${p}.kind`), pos: vec3(r['pos'], `${p}.pos`),
        size: vec3(r['size'], `${p}.size`),
      }, {
        digits: optNum(r, 'digits', p), cells: optNum(r, 'cells', p),
        color: r['color'] === undefined ? undefined : str(r['color'], `${p}.color`),
      });
    }),
    cavities: list(o['cavities'] ?? [], 'art.cavities', (x, p) => {
      const r = rec(x, p);
      // M4 (E4a): fill-pass fields are optional (parts exported before the LUT bake carry name / matter only)
      const m = r['mesh'] === undefined ? undefined : rec(r['mesh'], `${p}.mesh`);
      const t = r['tilt'] === undefined ? undefined : rec(r['tilt'], `${p}.tilt`);
      return withOptional<ArtCavity>({ name: str(r['name'], `${p}.name`), matter: str(r['matter'], `${p}.matter`) }, {
        capacity: optNum(r, 'capacity', p), fill: optNum(r, 'fill', p), volume: optNum(r, 'volume', p),
        min: r['min'] === undefined ? undefined : vec3(r['min'], `${p}.min`),
        max: r['max'] === undefined ? undefined : vec3(r['max'], `${p}.max`),
        lut: r['lut'] === undefined ? undefined : list(r['lut'], `${p}.lut`, num),
        mesh: m && { vertices: list(m['vertices'], `${p}.mesh.vertices`, num), indices: list(m['indices'], `${p}.mesh.indices`, num) },
        pivot: r['pivot'] === undefined ? undefined : str(r['pivot'], `${p}.pivot`),
        tilt: t && {
          pivot: str(t['pivot'], `${p}.tilt.pivot`), axis: vec3(t['axis'], `${p}.tilt.axis`), origin: vec3(t['origin'], `${p}.tilt.origin`),
          angles: list(t['angles'], `${p}.tilt.angles`, num),
          luts: list(t['luts'], `${p}.tilt.luts`, (x, q) => list(x, q, num)),
        },
      });
    }),
    ledGroups: list(o['ledGroups'], 'art.ledGroups', (x, p) => {
      const r = rec(x, p);
      return { index: num(r['index'], `${p}.index`), name: str(r['name'], `${p}.name`) };
    }),
    lods,
    clips: list(o['clips'], 'art.clips', str),
    skins: list(o['skins'], 'art.skins', str),
    massHint: num(o['massHint'], 'art.massHint'),
    materials: list(o['materials'], 'art.materials', str),
    hints,
  };
  if (o['notes'] !== undefined) art.notes = str(o['notes'], 'art.notes');
  if (o['textures'] !== undefined) {
    const t = rec(o['textures'], 'art.textures');
    art.textures = {
      albedo: str(t['albedo'], 'art.textures.albedo'), normal: str(t['normal'], 'art.textures.normal'),
      orm: str(t['orm'], 'art.textures.orm'), size: num(t['size'], 'art.textures.size'),
      set: t['set'] === undefined ? 'body' : str(t['set'], 'art.textures.set'),
      format: t['format'] === undefined ? 'png' : str(t['format'], 'art.textures.format'),
      slots: t['slots'] === undefined ? [] : list(t['slots'], 'art.textures.slots', str),
    };
    if (![1024, 2048, 4096].includes(art.textures.size)) throw new AssetFormatError('art.textures.size: expected 1024, 2048 or 4096');
  }
  return art;
}

export function parseShapesJson(input: unknown): ShapesJson {
  const o = rec(input, 'shapes');
  const shapes = list(o['shapes'], 'shapes.shapes', (x, p): Shape => {
    const r = rec(x, p);
    const base = withOptional<ShapeBase>({
      name: str(r['name'], `${p}.name`), pos: vec3(r['pos'], `${p}.pos`), rot: vec4(r['rot'], `${p}.rot`),
      phys: str(r['phys'], `${p}.phys`),
    }, {
      restitution: optNum(r, 'restitution', p), friction: optNum(r, 'friction', p),
      sharp: r['sharp'] === undefined ? undefined : r['sharp'] === true,
    });
    const kind = oneOf(r['kind'], SHAPE_KINDS, `${p}.kind`);
    switch (kind) {
      case 'sphere':
        return { ...base, kind, radius: num(r['radius'], `${p}.radius`) };
      case 'box':
        return { ...base, kind, halfExtents: vec3(r['halfExtents'], `${p}.halfExtents`),
          convexRadius: r['convexRadius'] === undefined ? 0 : num(r['convexRadius'], `${p}.convexRadius`) };
      case 'capsule':
      case 'cylinder':
      case 'wheel':
        return { ...base, kind, radius: num(r['radius'], `${p}.radius`), halfHeight: num(r['halfHeight'], `${p}.halfHeight`) };
      case 'hull':
        return { ...base, kind, points: list(r['points'], `${p}.points`, vec3) };
      case 'mesh':
        return { ...base, kind, vertices: list(r['vertices'], `${p}.vertices`, vec3),
          indices: list(r['indices'], `${p}.indices`, num) };
    }
  });
  if (shapes.length === 0) throw new AssetFormatError('shapes.shapes: a part needs at least one shape');
  if (shapes.length > 12) throw new AssetFormatError('shapes.shapes: more than 12 shapes');
  return { type: str(o['type'], 'shapes.type'), shapes };
}
