// Critter rendering (contract 3, docs/dev/M2_PLAN.md): GPU-skinned critters from their rigged glbs.
//
// - Not ragdolled: the skinned mesh sits at the base body's transform and plays `<type>__<clip>` from the
//   glb, timed on the render clock (× playback speed, frozen while paused) and cross-faded on clip change.
// - Ragdolled: each `RAG__<bone>` bone takes its rag body's transform (through the capsule's rest
//   transform from the def, so the bone keeps its own rest frame), and every other bone follows its
//   parent with its rest pose.
// - Build mode: critters stand at their part pose playing `idle`.
// - No rigged art yet: the instance fills keep the blockout, and a ragdolled critter shows its capsules.
// - Faces (M2 follow-up): the glb's shape keys (ART_BIBLE §8: sk_happy, sk_angry, sk_blink_l…) are driven by
//   the current emote and clip, eased, with an idle blink; GPU morphing in vs_skin.
// - Emote bubbles over the head bone (gfx/emotes.ts); BANDIT's stolen item rides his animated `prop_r`.

import { decomposeTrs, parseGlb, type ParsedGlb } from '@knockon/assets';
import type { PartRecord } from '@knockon/format';
import * as partsData from '@knockon/parts-data';
import { BUZZ_ROTORS, CRITTER_WINCH_SHIFT, partDef } from '@knockon/parts-data';
import { hexLin } from '../catalog.ts';
import { partPose, skinnedParts } from '../scene.ts';
import { settings } from '../ui/settings.ts';
import { EmoteBubbles, type EmoteShow } from './emotes.ts';
import type { Renderer, SceneItem, SkinnedItem } from './renderer.ts';
import { invert4, mul4, poseMatrix, Rig, skinnedFromGlb, type RigClip, type SkinLeds } from './skin.ts';
import { glbLedGroups, ledCode } from './leds.ts'; // R5 (M5): BUZZ's LED groups
import { partTexLook } from './glbmesh.ts';
import type { MaterialLook } from './look/materials.ts';
import { wormGlb } from './skintest.ts';
import { iconCode, type ScreenInfo } from './screens.ts'; // R5 (M5): LED icon faces

export const CRITTER_TYPES = ['mochi', 'pip', 'goby', 'bandit', 'biscuit', 'henny', 'dusty'] as const;
/** Clips that play once and hold their last frame (everything else loops), when the art has no `clipInfo`. */
const ONE_SHOT = /^(startled|tumble|getup|wheel_exit|burrow_enter|burrow_exit|pedal_mount|pedal_dismount|steal_grab|pounce|bubble_rescue|bark|wake_startle|barge|shake_off|lay_egg|bump_turn|bin_full)$/;
const FADE_S = 0.25;
const RAGDOLL_BIT = 1;

interface CritterArt {
  readonly type: string;
  readonly mesh: number;
  readonly rig: Rig;
  /** Short clip name (`idle`) → clip (`<type>__idle`). */
  readonly clips: Map<string, RigClip>;
  /** Per rig slot: inverse(capsule rest) × bone rest global, for RAG__ bones; null elsewhere. */
  readonly ragOffset: (Float32Array | null)[];
  /** Rig slot per ragdoll bone name (`RAG__hips` → slot of `hips`). */
  readonly ragSlot: Map<string, number>;
  /** The `root` bone's rest position in the glb (the floor under the COM): the sim's base body and the
   * ragdoll rest transforms are relative to it, the glb is authored around the COM (stream E2). */
  readonly rootPos: [number, number, number];
  /** Slot of the ragdoll's root capsule (parent −1) and the inverse of its bone's rest global. */
  readonly ragRoot: number;
  readonly ragRootInvRest: Float32Array;
  /** Shape-key names in morph-weight order (the skinned mesh's targets). */
  readonly shapeKeys: readonly string[];
  /** M4: loop flag per short clip name from the `.art.json` `clipInfo` (absent: the ONE_SHOT list). */
  readonly loops: ReadonlyMap<string, boolean>;
  /** R5 (M5): LED icon face tracks (DUSTY, BUZZ), when the art has them. */
  readonly face?: FaceArt;
}

/** R5 (M5): the `.art.json` fields of an LED-face critter (critters.md DUSTY / BUZZ: `faceTracks` per clip). */
interface FaceJson {
  readonly screens?: ScreenInfo[];
  readonly faceTracks?: Record<string, [number, string][]>;
  readonly faceIcons?: string[];
  readonly clipFps?: number;
}
export interface FaceArt {
  readonly screens: readonly ScreenInfo[];
  /** Clip → [frame, icon code] keys, sorted by frame. */
  readonly tracks: ReadonlyMap<string, readonly (readonly [number, number])[]>;
  readonly fps: number;
}
function faceArt(j: FaceJson): FaceArt {
  const tracks = new Map<string, (readonly [number, number])[]>();
  for (const [clip, keys] of Object.entries(j.faceTracks ?? {})) {
    tracks.set(clip, keys.map(([f, name]) => [f, iconCode(name)] as const).sort((a, b) => a[0] - b[0]));
  }
  return { screens: j.screens ?? [], tracks, fps: j.clipFps ?? 30 };
}

/** R5 (M5): LED group colours (linear) for critters whose `kn_led` faces carry groups (E5b: BUZZ nav, ducts, cargo, strobe). */
const CRITTER_LEDS: Readonly<Record<string, readonly (readonly number[])[]>> = {
  buzz: [hexLin('#EEF1F6'), hexLin('#EEF1F6'), hexLin('#FFC21A'), hexLin('#FFB020')],
};
/** R5 (M5): BUZZ's rotors (E5b: PIVOT__rotor_* props): cw / ccw about +Y, idle and max rps, the blur-disc threshold. */
const ROTORS = [{ bone: 'rotor_fl', dir: -1 }, { bone: 'rotor_fr', dir: 1 }, { bone: 'rotor_bl', dir: 1 }, { bone: 'rotor_br', dir: -1 }] as const;
const ROTOR = { idle: 45, max: 90, blur: 20, radius: 0.048 } as const;
const FAST_CLIPS = /^(run|chase|flee|takeoff)$/;
const CARRY_CLIPS = /^(carry|grab|drop_off|deliver_bow)$/;
const ROPE_RGB = hexLin('#EDE6D8');

/** R5 (M5): an emote overrides the clip's face (the brief's emote → icon reading; unknown emotes keep the clip's). */
const EMOTE_ICON: Readonly<Record<string, string>> = {
  '!': 'surprised', '?': 'scan', zzz: 'sleepy', stars: 'dizzy', heart: 'happy', sparkle: 'happy', grin: 'happy', snack_heart: 'happy',
  angry: 'angry', grumpy: 'angry', steam: 'angry', sweat: 'scared', stopwatch: 'determined',
};

/** R5 (M5): the LED face icon code (gfx/screens.ts) for a clip at time `t` (s), looped or held like the pose. */
export function faceIconAt(face: FaceArt, clip: string, t: number, duration: number, once: boolean, emote = 'none'): number {
  const em = EMOTE_ICON[emote];
  if (em) return iconCode(em);
  const keys = face.tracks.get(clip) ?? face.tracks.get('idle');
  if (!keys?.length) return iconCode('neutral');
  const tt = duration > 0 ? (once ? Math.min(t, duration) : t % duration) : t;
  const frame = Math.floor(tt * face.fps + 1e-6);
  let code = keys[0]![1];
  for (const [f, c] of keys) { if (f <= frame) code = c; else break; }
  return code;
}

const qrot3 = (q: ArrayLike<number>, v: readonly number[]): [number, number, number] => {
  const x = q[0]!, y = q[1]!, z = q[2]!, w = q[3]!;
  const tx = 2 * (y * v[2]! - z * v[1]!), ty = 2 * (z * v[0]! - x * v[2]!), tz = 2 * (x * v[1]! - y * v[0]!);
  return [v[0]! + w * tx + (y * tz - z * ty), v[1]! + w * ty + (z * tx - x * tz), v[2]! + w * tz + (x * ty - y * tx)];
};

interface AnimState {
  clip: string; t: number; from: string | null; fromT: number; fade: number; bones: Float32Array; seen: number;
  sockets: Map<string, Float32Array>; face: Float32Array; seed: number;
  /** R5 (M5): a flying robot's rotor speed (rps) and angle, winch payout (m, −1 = the clip's) and LED code. */
  dev?: { rps: number; ang: number; winch: number; leds: number };
}

/**
 * Expression targets (shape-key name → weight) for a clip and an emote. Names follow the critter briefs'
 * shape-key list; keys a critter lacks are simply absent. Clip and emote combine by max.
 */
export function expression(clip: string, emote: string): Record<string, number> {
  const f: Record<string, number> = {};
  const set = (k: string, v: number): void => { f[k] = Math.max(f[k] ?? 0, v); };
  const both = (k: string, v: number): void => { set(`${k}_l`, v); set(`${k}_r`, v); };
  switch (clip) {
    case 'startled': set('sk_surprised', 1); set('sk_scared', 0.5); both('sk_brow_up', 0.8); break;
    case 'flee': case 'arch_scared': set('sk_scared', 1); both('sk_brow_up', 0.6); if (clip === 'arch_scared') set('sk_fur_puff', 1); break;
    case 'sleep': case 'wheel_sleep': set('sk_sleepy', 1); both('sk_blink', 1); break;
    case 'dizzy': case 'tumble': set('sk_dizzy', 1); set('sk_comb_flop', 1); break;
    case 'celebrate': case 'emote_happy': case 'loot_admire': set('sk_happy', 1); set('sk_vis_e', 0.4); break;
    case 'emote_angry': set('sk_angry', 1); both('sk_brow_down', 1); break;
    case 'emote_confused': set('sk_brow_up_l', 1); set('sk_brow_down_r', 0.5); set('sk_smug', 0.3); break;
    case 'chase': case 'stalk': case 'pounce': case 'wheel_sprint': case 'pedal': case 'steal_grab':
      set('sk_determined', 1); both('sk_brow_down', 0.4); if (clip === 'stalk') set('sk_whiskers_fwd', 1); break;
    case 'sniff': set('sk_whiskers_fwd', 1); set('sk_nose_wrinkle', 1); break;
    // M4 (E4b's keys): BISCUIT's bark and barge, HENNY's flap, lay and puff
    case 'bark': case 'bark_run': set('sk_tongue_out', 0.4); set('sk_jowl_puff', 0.6); set('sk_beak_wide', 1); break;
    case 'barge': set('sk_determined', 1); set('sk_jowl_puff', 1); break;
    case 'tail_wag': case 'pant': set('sk_happy', 0.8); set('sk_tongue_out', 1); break;
    case 'shake_off': set('sk_jowl_puff', 0.8); both('sk_blink', 0.6); break;
    case 'wake_startle': set('sk_surprised', 1); both('sk_brow_up', 0.8); set('sk_feather_fluff', 1); break;
    case 'flap': case 'glide_down': set('sk_beak_wide', 0.7); set('sk_feather_fluff', 0.6); break;
    case 'lay_egg': set('sk_determined', 0.6); set('sk_feather_fluff', 0.8); break;
    case 'proud_puff': set('sk_happy', 0.8); set('sk_feather_fluff', 1); break;
    case 'peck': case 'scratch': set('sk_determined', 0.4); break;
    case 'groom': case 'wash_hands': set('sk_blep', 0.8); both('sk_blink', 0.5); break;
    case 'trapped': set('sk_angry', 0.4); set('sk_scared', 0.5); break;
    default:
  }
  switch (emote) {
    case '!': case 'cat_alert': case 'dog_alert': case 'eyes_pip': set('sk_surprised', 1); both('sk_brow_up', 0.8); break;
    case '?': set('sk_brow_up_l', 1); set('sk_brow_down_r', 0.4); set('sk_vis_o', 0.3); break;
    case 'zzz': set('sk_sleepy', 1); both('sk_blink', 0.9); break;
    case 'stars': set('sk_dizzy', 1); break;
    case 'heart': case 'snack_heart': case 'sparkle': set('sk_happy', 1); break;
    case 'grin': set('sk_happy', 1); set('sk_vis_e', 0.6); break;
    case 'kiss': set('sk_happy', 0.6); set('sk_vis_o', 0.8); break;
    case 'angry': case 'grumpy': case 'steam': set('sk_angry', 1); both('sk_brow_down', 1); break;
    case 'sweat': set('sk_scared', 0.8); both('sk_brow_up', 0.5); break;
    case 'seed': case 'food_flake': set('sk_happy', 0.6); set('sk_vis_a', 0.3); break;
    case 'bubbles': case 'water_drop': set('sk_surprised', 0.4); break;
    case 'stopwatch': case 'pedal': set('sk_determined', 1); break;
    default:
  }
  return f;
}

/** Bones whose world pose other systems read (`boneWorld`): BANDIT's stolen-item socket, the head (emotes). */
export const SOCKET_BONES = ['prop_r', 'head'] as const;

/** The parts of RunController this view reads (B adds `critters` and the rag bodies). */
export interface CritterRunLike {
  readonly phase: string;
  readonly bodies: readonly { readonly part: number; readonly type: string; readonly role: string; readonly bone?: string }[];
  readonly transforms: Float32Array;
  readonly partIds: readonly number[];
  readonly paused: boolean;
  readonly speed: number;
  readonly critters?: Uint8Array;
}

const clipNames = (): readonly string[] => ((partsData as unknown as Record<string, unknown>)['CRITTER_CLIPS'] as readonly string[] | undefined) ?? ['idle'];

export class CritterView {
  private readonly r: Renderer;
  private readonly arts = new Map<string, CritterArt>();
  private readonly anims = new Map<string, AnimState>();
  private indexedFor: unknown = null;
  private baseBody = new Map<number, number>();
  private ragBodies = new Map<number, { bone: string; body: number }[]>();
  private partIndex = new Map<number, number>();
  private frameNo = 0;
  private readonly tmp = new Float32Array(16);
  private readonly tmp2 = new Float32Array(16);
  /** R5 (M5): debug: every LED face shows this icon code (gfx/screens.ts), null = the clips' tracks. */
  faceOverride: ((seed: number) => number) | null = null;
  /** R5 (M5): debug: critterState byte 1 for build-mode critters (BUZZ: 16 rotors, bits 5–7 winch), null = landed. */
  debugFlags: number | null = null;
  /** Photo mode hides the emote bubbles (so does `body.photo-mode`). */
  photoMode = false;
  private emotes: EmoteBubbles | null = null;
  /** `?debug&skintest=N`: N test worms near the origin cycling clips (every other one ragdolled). */
  test: { n: number; ragdoll: boolean; t: number } | null = null;

  constructor(renderer: Renderer) { this.r = renderer; }

  /** Loads `/parts/<type>/<type>.glb` for each critter type; types without a skinned glb keep the blockout. */
  async load(types: readonly string[] = CRITTER_TYPES): Promise<string[]> {
    const ok: string[] = [];
    await Promise.all(types.map(async (t) => {
      try {
        const res = await fetch(`/parts/${t}/${t}.glb`);
        if (!res.ok) return;
        const bytes = await res.arrayBuffer();
        const glb = parseGlb(bytes);
        const ledColors = CRITTER_LEDS[t]; // R5 (M5): BUZZ's LED groups
        const leds = ledColors ? { groups: glbLedGroups(bytes, glb), colors: ledColors } : undefined;
        // M4: the critter's texture set (E4b exports one per critter) and its clips' loop flags
        const look = await partTexLook(this.r, t, glb);
        const loops = new Map<string, boolean>();
        let face: FaceArt | undefined;
        try {
          const ar = await fetch(`/parts/${t}/${t}.art.json`);
          const aj = ar.ok ? (await ar.json()) as { clipInfo?: { name: string; loop: boolean }[] } & FaceJson : undefined;
          for (const c of aj?.clipInfo ?? []) loops.set(c.name, c.loop);
          face = aj ? faceArt(aj) : undefined; // R5 (M5): LED icon faces (DUSTY, BUZZ)
        } catch { /* no clip info: the ONE_SHOT list */ }
        if (this.register(t, glb, look, loops, face, leds)) ok.push(t);
      } catch { /* not built yet: blockout */ }
    }));
    return ok;
  }

  /** Registers a rigged glb as the art of `type`; false when it has no skin. */
  register(type: string, glb: ParsedGlb, look?: MaterialLook, loops: ReadonlyMap<string, boolean> = new Map(), face?: FaceArt, leds?: SkinLeds): boolean {
    const geom = skinnedFromGlb(glb, 0, look, face?.screens ?? [], leds);
    if (!geom) return false;
    const rig = new Rig(glb, 0, SOCKET_BONES);
    const mesh = this.r.addSkinnedMesh(type, geom, rig.jointCount);
    const clips = new Map<string, RigClip>();
    for (const [name, c] of rig.clips) clips.set(name.startsWith(`${type}__`) ? name.slice(type.length + 2) : name, c);
    const ragOffset: (Float32Array | null)[] = rig.order.map(() => null);
    const ragSlot = new Map<string, number>();
    const rag = partDef(type)?.critter?.ragdoll ?? [];
    const rs = rig.slotOf('root');
    const rootPos: [number, number, number] = rs >= 0 ? [rig.restGlobal[rs * 16 + 12]!, rig.restGlobal[rs * 16 + 13]!, rig.restGlobal[rs * 16 + 14]!] : [0, 0, 0];
    let ragRoot = -1;
    const ragRootInvRest = new Float32Array(16);
    for (const rb of rag) {
      const slot = rig.slotOf(rb.bone);
      if (slot < 0) continue;
      ragSlot.set(rb.bone, slot);
      if (rb.parent === -1 && ragRoot < 0) { ragRoot = slot; invert4(ragRootInvRest, rig.restGlobal.subarray(slot * 16, slot * 16 + 16)); }
      // capsule rest in glb model space = T(rootPos) × (at, rot)
      const inv = new Float32Array(16);
      invert4(inv, poseMatrix(this.tmp, [rb.at[0] + rootPos[0], rb.at[1] + rootPos[1], rb.at[2] + rootPos[2]], rb.rot));
      const off = new Float32Array(16);
      mul4(off, inv, rig.restGlobal, 0, slot * 16);
      ragOffset[slot] = off;
    }
    this.arts.set(type, { type, mesh, rig, clips, ragOffset, ragSlot, rootPos, ragRoot, ragRootInvRest, shapeKeys: geom.morph?.names ?? [], loops, ...(face?.tracks.size ? { face } : {}) });
    if (type !== 'worm') skinnedParts.add(type);
    return true;
  }

  has(type: string): boolean { return this.arts.has(type); }

  /** Shows N test worms (generated glb) for checking the skinning path in the browser. */
  enableTest(n: number, ragdoll = true): void {
    if (!this.arts.has('worm')) this.register('worm', wormGlb());
    this.test = { n, ragdoll, t: 0 };
  }

  /**
   * Per frame: animates every critter and hands the skinned instances to the renderer. Fallback capsules
   * for ragdolled critters without art are appended to `overlay`.
   */
  frame(dt: number, parts: Iterable<PartRecord> | undefined, run: CritterRunLike, overlay: SceneItem[]): void {
    this.frameNo++;
    const items: SkinnedItem[] = [];
    const running = run.phase === 'running' && run.bodies.length > 0 && run.transforms.length > 0;
    const clock = running ? (run.paused ? 0 : dt * run.speed) : dt;
    const names = clipNames();
    const emoteNames = ((partsData as unknown as Record<string, unknown>)['CRITTER_EMOTES'] as readonly string[] | undefined) ?? ['none'];
    const shows: EmoteShow[] = [];
    const now = performance.now();
    if (running) {
      this.index(run);
      const xf = run.transforms;
      for (const [id, bi] of this.baseBody) {
        const type = run.bodies[bi]!.type;
        const art = this.arts.get(type);
        const pi = this.partIndex.get(id) ?? -1;
        const st = run.critters && pi >= 0 ? run.critters.subarray(pi * 4, pi * 4 + 4) : null;
        const ragdoll = st !== null && ((st[1] ?? 0) & RAGDOLL_BIT) !== 0;
        const rags = this.ragBodies.get(id) ?? [];
        if (!art) {
          if (ragdoll) for (const rb of rags) overlay.push(capsuleItem(type, rb.bone, xf, rb.body));
          continue;
        }
        const a = this.anim(`p${id}`, art, names[st?.[0] ?? 0] ?? 'idle', clock);
        const emote = emoteNames[st?.[2] ?? 0] ?? 'none';
        this.face(art, a, ragdoll ? 'tumble' : a.clip, emote, dt, now);
        if (ragdoll && rags.length) {
          const bySlot = new Map<number, number>();
          for (const rb of rags) { const s = art.ragSlot.get(rb.bone) ?? art.rig.slotOf(rb.bone); if (s >= 0) bySlot.set(s, rb.body); }
          const boneFromBody = (slot: number, b: number, out: Float32Array): void => {
            poseMatrix(this.tmp2, xf.subarray(b * 7, b * 7 + 3), xf.subarray(b * 7 + 3, b * 7 + 7));
            const off = art.ragOffset[slot];
            if (off) mul4(out, this.tmp2, off); else out.set(this.tmp2);
          };
          // the model frame implied by the ragdoll's root capsule: carries the bones above it (root, armature)
          const model = new Float32Array(16);
          const rb0 = bySlot.get(art.ragRoot);
          if (rb0 !== undefined) { const g = new Float32Array(16); boneFromBody(art.ragRoot, rb0, g); mul4(model, g, art.ragRootInvRest); }
          else poseMatrix(model, xf.subarray(bi * 7, bi * 7 + 3), xf.subarray(bi * 7 + 3, bi * 7 + 7));
          art.rig.evaluate({ clip: null, t: 0 }, a.bones, 0, (slot, out) => {
            const b = bySlot.get(slot);
            if (b !== undefined) { boneFromBody(slot, b, out); return true; }
            if (art.rig.parentSlot[slot] === -1) { mul4(out, model, art.rig.restGlobal, 0, slot * 16); return true; }
            return false;
          });
          this.capture(art, a, [0, 0, 0], [0, 0, 0, 1]);
          items.push({ mesh: art.mesh, pos: [0, 0, 0], rot: [0, 0, 0, 1], bones: a.bones, morph: a.face, ...this.icon(art, a, 'tumble', emote) });
        } else {
          this.pose(art, a, this.device(art, a, st, clock, now)); // R5 (M5): BUZZ's rotors, winch and LEDs
          const o = bi * 7;
          const rot: [number, number, number, number] = [xf[o + 3]!, xf[o + 4]!, xf[o + 5]!, xf[o + 6]!];
          // the base body sits on the root bone (floor); the glb is authored around the COM
          const lift = qrot3(rot, [-art.rootPos[0], -art.rootPos[1], -art.rootPos[2]]);
          const pos: [number, number, number] = [xf[o]! + lift[0], xf[o + 1]! + lift[1], xf[o + 2]! + lift[2]];
          this.capture(art, a, pos, rot);
          this.deviceOverlay(art, a, pos, rot, overlay);
          items.push({ mesh: art.mesh, pos, rot, bones: a.bones, morph: a.face, ...this.icon(art, a, a.clip, emote), ...(a.dev ? { leds: a.dev.leds } : {}) });
          if (type === 'bandit') this.carry(run, art, bi, pos, rot);
        }
        if (emote !== 'none') this.show(shows, `p${id}`, art, a, emote);
      }
    } else if (parts) {
      for (const p of parts) {
        const art = this.arts.get(p.type);
        if (!art) continue;
        const a = this.anim(`p${p.id}`, art, 'idle', clock);
        this.face(art, a, 'idle', 'none', dt, now);
        this.pose(art, a, this.device(art, a, this.debugFlags !== null ? Uint8Array.of(0, this.debugFlags, 0, 0) : null, clock, now)); // R5 (M5): landed BUZZ
        const pose = partPose(p);
        const lift = qrot3(pose.rot, [-art.rootPos[0], -art.rootPos[1], -art.rootPos[2]]);
        const pos: [number, number, number] = [pose.pos[0] + lift[0], pose.pos[1] + lift[1], pose.pos[2] + lift[2]];
        this.capture(art, a, pos, pose.rot);
        this.deviceOverlay(art, a, pos, pose.rot, overlay);
        items.push({ mesh: art.mesh, pos, rot: pose.rot, bones: a.bones, morph: a.face, ...this.icon(art, a, a.clip, 'none'), ...(a.dev ? { leds: a.dev.leds } : {}) });
      }
    }
    if (this.test) this.testFrame(dt, items);
    this.emotes ??= this.r.canvas.parentElement ? new EmoteBubbles(this.r.canvas.parentElement) : null;
    if (this.emotes) {
      this.emotes.reducedMotion = settings.comfort.reducedMotion;
      this.emotes.hidden = this.photoMode || document.body.classList.contains('photo-mode');
      this.emotes.update(shows, this.r.viewProj, this.r.eye, this.r.canvas, now);
    }
    // forget critters that went away
    for (const [k, a] of this.anims) if (this.frameNo - a.seen > 120) this.anims.delete(k);
    this.r.setSkinned(items);
  }

  /**
   * World pose of a critter's bone from this frame's animation (`prop_r` for BANDIT's stolen item,
   * `head`), or null when the critter has no rigged art or wasn't drawn this frame.
   */
  boneWorld(partId: number, bone: (typeof SOCKET_BONES)[number]): { pos: [number, number, number]; rot: [number, number, number, number] } | null {
    const a = this.anims.get(`p${partId}`);
    const m = a && this.frameNo - a.seen <= 1 ? a.sockets.get(bone) : undefined;
    if (!m) return null;
    const d = decomposeTrs(m);
    return { pos: d.t, rot: d.r };
  }

  /** R5 (M5): the LED face icon for this frame (`.art.json faceTracks` of the playing clip; an emote overrides it). */
  private icon(art: CritterArt, a: AnimState, clip: string, emote: string): { face?: number } {
    if (!art.face) return {};
    if (this.faceOverride !== null) return { face: this.faceOverride(a.seed) };
    const c = art.clips.get(clip);
    const once = art.loops.has(clip) ? !art.loops.get(clip) : ONE_SHOT.test(clip);
    return { face: faceIconAt(art.face, clip, clip === a.clip ? a.t : 0, c?.duration ?? 0, once, emote) };
  }

  /** Eases the face toward this clip's and emote's expression, with a blink every few seconds. */
  private face(art: CritterArt, a: AnimState, clip: string, emote: string, dt: number, now: number): void {
    const keys = art.shapeKeys;
    if (!keys.length) return;
    const want = expression(clip, emote);
    // idle blink: ~0.16 s every 3–5 s, offset per critter
    const period = 3 + (a.seed % 200) / 100;
    const ph = (now / 1000 + (a.seed % 97) * 0.13) % period;
    const blink = ph < 0.16 ? Math.sin((ph / 0.16) * Math.PI) : 0;
    const k = Math.min(1, dt * 12);
    keys.forEach((name, i) => {
      const isBlink = name === 'sk_blink_l' || name === 'sk_blink_r';
      const w = isBlink ? Math.max(want[name] ?? 0, blink) : want[name] ?? 0;
      a.face[i] = isBlink && blink > 0 ? w : a.face[i]! + (w - a.face[i]!) * k;
    });
  }

  /** A bubble just above the head bone (higher for bigger critters). */
  private show(shows: EmoteShow[], key: string, art: CritterArt, a: AnimState, emote: string): void {
    const m = a.sockets.get('head');
    if (!m) return;
    const up = Math.max(0.05, Math.abs(art.rootPos[1]) * 0.8 + 0.04);
    shows.push({ key, pos: [m[12]!, m[13]! + up, m[14]!], emote });
  }

  /**
   * BANDIT's stolen item: the sim parks it at `BANDIT_PROP_R` off his base body; find it there and redraw it
   * at the animated `prop_r` bone (the rest-pose prop point carried by the bone's animation).
   */
  private carry(run: CritterRunLike, art: CritterArt, bi: number, pos: readonly number[], rot: readonly number[]): void {
    const slot = art.rig.slotOf('prop_r');
    const prop = (partsData as unknown as Record<string, unknown>)['BANDIT_PROP_R'] as readonly number[] | undefined;
    if (slot < 0 || !prop) return;
    const xf = run.transforms, o = bi * 7;
    const w = qrot3(xf.subarray(o + 3, o + 7), prop);
    const P = [xf[o]! + w[0], xf[o + 1]! + w[1], xf[o + 2]! + w[2]];
    let item = -1;
    for (let i = 0; i < run.bodies.length; i++) {
      const b = run.bodies[i]!;
      if (b.role !== 'base' || i === bi || this.arts.has(b.type)) continue;
      if (Math.abs(xf[i * 7]! - P[0]!) < 0.003 && Math.abs(xf[i * 7 + 1]! - P[1]!) < 0.003 && Math.abs(xf[i * 7 + 2]! - P[2]!) < 0.003) { item = i; break; }
    }
    this.carried = item;
    if (item < 0) return;
    // the item sits on the socket: world = instance × G(prop_r) (the bone is a non-deform socket in his hand)
    const out = new Float32Array(16);
    mul4(out, poseMatrix(new Float32Array(16), pos, rot), art.rig.globalOf(slot));
    const d = decomposeTrs(out);
    this.r.patchBody(item, d.t, d.r);
  }
  /** Body index of the item BANDIT carries this frame (debug), or −1. */
  carried = -1;

  private capture(art: CritterArt, a: AnimState, pos: readonly number[], rot: readonly number[]): void {
    const inst = poseMatrix(this.tmp, pos, rot);
    for (const name of SOCKET_BONES) {
      const slot = art.rig.slotOf(name);
      if (slot < 0) continue;
      const out = a.sockets.get(name) ?? new Float32Array(16);
      mul4(out, inst, art.rig.globalOf(slot));
      a.sockets.set(name, out);
    }
  }

  private index(run: CritterRunLike): void {
    if (this.indexedFor === run.bodies) return;
    this.indexedFor = run.bodies;
    this.baseBody = new Map();
    this.ragBodies = new Map();
    this.partIndex = new Map(run.partIds.map((id, i) => [id, i]));
    run.bodies.forEach((b, i) => {
      const critter = this.arts.has(b.type) || (CRITTER_TYPES as readonly string[]).includes(b.type) || partDef(b.type)?.critter !== undefined;
      if (!critter) return;
      if (b.role === 'base') this.baseBody.set(b.part, i);
      else if (b.role === 'rag' && b.bone) {
        const l = this.ragBodies.get(b.part) ?? [];
        l.push({ bone: b.bone, body: i });
        this.ragBodies.set(b.part, l);
      }
    });
  }

  private anim(key: string, art: CritterArt, want: string, clock: number): AnimState {
    let a = this.anims.get(key);
    const clip = art.clips.has(want) ? want : art.clips.has('idle') ? 'idle' : art.clips.keys().next().value ?? '';
    if (!a || a.bones.length < art.rig.jointCount * 12) {
      let seed = 0;
      for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) & 0xffff;
      a = { clip, t: 0, from: null, fromT: 0, fade: 1, bones: new Float32Array(art.rig.jointCount * 12), seen: this.frameNo, sockets: new Map(), face: new Float32Array(art.shapeKeys.length), seed };
      this.anims.set(key, a);
    }
    if (a.clip !== clip) {
      a.from = a.clip; a.fromT = a.t; a.clip = clip; a.t = 0; a.fade = 0;
    }
    a.t += clock;
    a.fromT += clock;
    a.fade = Math.min(1, a.fade + clock / FADE_S);
    if (a.fade >= 1) a.from = null;
    a.seen = this.frameNo;
    return a;
  }

  /**
   * R5 (M5): a flying robot's own motion on top of its clip (BUZZ, E5b): rotors spin for real at their rps (critterState
   * `rotors` bit; idle 45, fast clips 90) and swap to a blur disc above 20 rps; the winch pays out to the sim's length
   * (bits 5–7, sevenths of 0.60 m); LED groups: nav and ducts lit while flying, cargo while carrying, the amber strobe
   * blinking 1 Hz in flight. Returns the rig's local-pose edit (undefined for critters without these bones).
   */
  private device(art: CritterArt, a: AnimState, st: Uint8Array | null, clock: number, now: number): ((local: Float32Array) => void) | undefined {
    if (!CRITTER_LEDS[art.type] && art.rig.slotOf('rotor_fl') < 0) return undefined;
    const d = a.dev ??= { rps: 0, ang: 0, winch: -1, leds: 0 };
    const flags = st?.[1] ?? 0;
    const flying = (flags & BUZZ_ROTORS) !== 0;
    const fast = FAST_CLIPS.test(a.clip);
    const target = flying ? (fast ? ROTOR.max : ROTOR.idle) : 0;
    d.rps += Math.max(-40 * clock, Math.min(120 * clock, target - d.rps));
    d.ang = (d.ang + d.rps * Math.PI * 2 * clock) % (Math.PI * 2000);
    const w = (flags >> CRITTER_WINCH_SHIFT) & 7;
    d.winch = st && w > 0 ? (w / 7) * 0.6 : -1;
    const strobe = flying && (now / 1000) % 1 < 0.12;
    d.leds = ledCode([flying ? 3 : 1, flying ? (fast ? 3 : 2) : 1, CARRY_CLIPS.test(a.clip) || d.winch > 0 ? 3 : 0, strobe ? 3 : 0]);
    const rig = art.rig;
    return (local) => {
      for (const r of ROTORS) {
        const s = rig.slotOf(r.bone);
        if (s < 0) continue;
        const o = s * 10, h = (r.dir * d.ang) / 2;
        const q0 = rig.rest.subarray(o + 3, o + 7), sy = Math.sin(h), cw = Math.cos(h);
        // rest rotation × spin about the bone's +Y
        local[o + 3] = q0[0]! * cw - q0[2]! * sy;
        local[o + 4] = q0[3]! * sy + q0[1]! * cw;
        local[o + 5] = q0[2]! * cw + q0[0]! * sy;
        local[o + 6] = q0[3]! * cw - q0[1]! * sy;
        if (d.rps > ROTOR.blur) { local[o + 7] = 0.001; local[o + 8] = 0.001; local[o + 9] = 0.001; }
      }
      const ws = rig.slotOf('winch');
      if (ws >= 0 && d.winch > 0) local[ws * 10 + 1] = rig.rest[ws * 10 + 1]! - d.winch;
    };
  }

  /** R5 (M5): the rotor blur discs (no mesh is authored: a thin translucent disc per duct) and the winch tether rope. */
  private deviceOverlay(art: CritterArt, a: AnimState, pos: readonly number[], rot: readonly number[], overlay: SceneItem[]): void {
    const d = a.dev;
    if (!d) return;
    const rig = art.rig;
    const inst = poseMatrix(new Float32Array(16), pos, rot);
    const m = new Float32Array(16);
    if (d.rps > ROTOR.blur) {
      const k = Math.min(1, (d.rps - ROTOR.blur) / 15);
      for (const r of ROTORS) {
        const s = rig.slotOf(r.bone);
        if (s < 0) continue;
        mul4(m, inst, rig.globalOf(s));
        const t = decomposeTrs(m);
        overlay.push({ pos: t.t, rot: t.r, size: [ROTOR.radius * 2, 0.002, ROTOR.radius * 2], mesh: 2, color: [0.075, 0.08, 0.095], alpha: 0.42 * k, rough: 0.35 });
      }
    }
    const ws = rig.slotOf('winch'), ps = ws >= 0 ? rig.parentSlot[ws]! : -1;
    if (ws < 0 || ps < 0) return;
    mul4(m, inst, rig.globalOf(ws));
    const end: [number, number, number] = [m[12]!, m[13]!, m[14]!];
    mul4(m, inst, rig.globalOf(ps));
    const rt = rig.rest.subarray(ws * 10, ws * 10 + 3);
    const spool: [number, number, number] = [m[0]! * rt[0]! + m[4]! * rt[1]! + m[8]! * rt[2]! + m[12]!, m[1]! * rt[0]! + m[5]! * rt[1]! + m[9]! * rt[2]! + m[13]!, m[2]! * rt[0]! + m[6]! * rt[1]! + m[10]! * rt[2]! + m[14]!];
    const dv = [end[0] - spool[0], end[1] - spool[1], end[2] - spool[2]];
    const L = Math.hypot(dv[0]!, dv[1]!, dv[2]!);
    if (L < 0.006) return;
    // a Ø 3 mm rope (kn_rope) from the spool to the winch bone: +Y of the unit cylinder turned onto the tether
    const y = [dv[0]! / L, dv[1]! / L, dv[2]! / L];
    const q: [number, number, number, number] = y[1]! < -0.9999 ? [1, 0, 0, 0] : (() => { const s2 = Math.sqrt((1 + y[1]!) * 2); return [y[2]! / s2, 0, -y[0]! / s2, s2 / 2] as [number, number, number, number]; })();
    overlay.push({ pos: [(end[0] + spool[0]) / 2, (end[1] + spool[1]) / 2, (end[2] + spool[2]) / 2], rot: q, size: [0.003, L, 0.003], mesh: 2, color: ROPE_RGB as unknown as [number, number, number], rough: 0.8 });
  }

  private pose(art: CritterArt, a: AnimState, adjust?: (local: Float32Array) => void): void {
    const time = (name: string | null, t: number): { c: RigClip | null; t: number } => {
      const c = name ? art.clips.get(name) ?? null : null;
      if (!c || c.duration <= 0) return { c, t: 0 };
      const once = art.loops.has(name!) ? !art.loops.get(name!) : ONE_SHOT.test(name!);
      return { c, t: once ? Math.min(t, c.duration) : t % c.duration };
    };
    const cur = time(a.clip, a.t), prev = time(a.from, a.fromT);
    art.rig.evaluate({ clip: cur.c, t: cur.t, from: prev.c, fromT: prev.t, w: a.from ? a.fade : 1, ...(adjust ? { adjust } : {}) }, a.bones, 0);
  }

  /** Test worms: a row cycling idle → run → tumble every 2.5 s (cross-faded); odd ones flop as a fake ragdoll. */
  private testFrame(dt: number, items: SkinnedItem[]): void {
    const art = this.arts.get('worm');
    const test = this.test;
    if (!art || !test) return;
    test.t += dt;
    const cycle = ['idle', 'run', 'tumble'];
    for (let i = 0; i < test.n; i++) {
      const x = (i % 8 - 3.5) * 0.25, z = Math.floor(i / 8) * 0.3 + 0.6;
      const a = this.anim(`test${i}`, art, cycle[Math.floor(test.t / 2.5 + i * 0.37) % 3]!, dt);
      if (test.ragdoll && i % 2 === 1) {
        // fake rag bodies: each bone's rest frame, tipped over progressively about the root
        const ang = Math.min(1.4, (test.t % 5) * 0.6), c = Math.cos(ang / 2), s = Math.sin(ang / 2);
        art.rig.evaluate({ clip: null, t: 0 }, a.bones, 0, (slot, out) => {
          if (slot === 0 || art.rig.names[slot] === 'Armature') return false;
          const tip = poseMatrix(this.tmp2, [x, 0, z], [s * 0.7, 0, s * 0.7, c]);
          const bend = new Float32Array(16);
          const k = slot * 0.25 * Math.sin(test.t * 3);
          poseMatrix(bend, [0, 0, 0], [0, 0, Math.sin(k / 2), Math.cos(k / 2)]);
          const t2 = new Float32Array(16);
          mul4(t2, tip, bend);
          mul4(out, t2, art.rig.restGlobal, 0, slot * 16);
          return true;
        });
        items.push({ mesh: art.mesh, pos: [0, 0, 0], rot: [0, 0, 0, 1], bones: a.bones });
      } else {
        this.pose(art, a);
        items.push({ mesh: art.mesh, pos: [x, 0, z], rot: [0, 0, 0, 1], bones: a.bones });
      }
    }
  }
}

/** A ragdoll capsule without art: the def's capsule as a stretched sphere on its body. */
function capsuleItem(type: string, bone: string, xf: Float32Array, b: number): SceneItem {
  const rb = partDef(type)?.critter?.ragdoll.find((r) => r.bone === bone);
  const rad = rb?.radius ?? 0.03, hh = rb?.halfHeight ?? 0.03;
  return {
    pos: [xf[b * 7]!, xf[b * 7 + 1]!, xf[b * 7 + 2]!], rot: [xf[b * 7 + 3]!, xf[b * 7 + 4]!, xf[b * 7 + 5]!, xf[b * 7 + 6]!],
    size: [rad * 2, (hh + rad) * 2, rad * 2], mesh: 1, color: [0.8, 0.55, 0.3], rough: 0.8,
  };
}
