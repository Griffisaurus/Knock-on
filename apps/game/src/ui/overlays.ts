// Accessibility overlays over the 3D view (M4 stream U4; GAME_SPEC §20, UI_UX §7):
//   • the caption strip: event captions above the run bar (Settings › Accessibility › Captions), with
//     a direction mark and repeats collapsed (ui/captions.ts holds the model);
//   • critter emote text: a name tag with the emote in words over each critter showing an emote bubble
//     (with captions on);
//   • port glyphs: wherever the renderer shows ports (Wire tool, the hovered or selected part, X-ray),
//     each port also gets its channel glyph on a dark chip, so channels never rely on colour alone
//     (Settings › Accessibility › Port glyphs, on by default). Inputs are hollow rings, outputs solid.
// All of it is aria-hidden (decorative for sighted players); screen readers get the same captions through
// the announcer, and the Inspector's Connections section lists ports as text.

import { PartFlag, type PartRecord } from '@knockon/format';
import { PartFlagBits, type SimEvent } from '@knockon/sim';
import { partDef } from '../catalog.ts';
import type { Renderer } from '../gfx/renderer.ts';
import { transform, type V3 } from '../math.ts';
import type { NetClient } from '../net.ts';
import type { RunController } from '../run.ts';
import { partPose, portWorld, type Pose, type PoseOf } from '../scene.ts';
import { announce } from './a11y.ts';
import { CaptionModel, captionFor, directionMark, emoteText, lineText, type CaptionLine } from './captions.ts';
import { glyph, h, ICON } from './icons.ts';
import { settings } from './settings.ts';

export interface OverlayLinks {
  renderer: Renderer;
  run: RunController;
  /** The Build tool, the hovered and selected parts, and the X-ray mode (which ports the renderer shows). */
  tool(): string;
  hoverPart(): PartRecord | null;
  selected(): readonly number[];
  xray(): string;
  /** Hidden / locked / sectioned-away parts aren't shown. */
  pickable(p: PartRecord): boolean;
  /** U5 (M5): letter chips for GRABBER's zones A and B (world points). */
  zoneLabels?(): readonly { at: readonly number[]; text: string; color?: string }[];
}

const MAX_PORT_CHIPS = 64;
const MAX_TAGS = 8;
const MAX_BUZZ_TAGS = 32;

export class A11yOverlays {
  private readonly strip: HTMLElement;
  private readonly glyphLayer: HTMLElement;
  private readonly tagLayer: HTMLElement;
  readonly captions = new CaptionModel();
  private readonly rows = new Map<number, HTMLElement>();
  private readonly chips: HTMLElement[] = [];
  private readonly tags: HTMLElement[] = [];
  private links: OverlayLinks | null = null;
  private lastExpire = 0;
  private bodiesRef: unknown = null;
  private readonly bodyIndex = new Map<string, number>();

  constructor(viewport: HTMLElement, private readonly net: NetClient) {
    this.strip = h('<div id="captions" aria-hidden="true"></div>');
    this.glyphLayer = h('<div id="portglyphs" aria-hidden="true"></div>');
    this.tagLayer = h('<div id="emotetags" aria-hidden="true"></div>');
    viewport.append(this.glyphLayer, this.tagLayer, this.strip);
  }

  bind(l: OverlayLinks): void {
    this.links = l;
    l.run.onEvents((evs) => this.onEvents(evs));
  }

  private get captionsOn(): boolean { return settings.accessibility.captions; }

  /** SimEvents → caption lines (and the announcer). */
  onEvents(evs: readonly SimEvent[]): void {
    if (!this.captionsOn) return;
    const doc = this.net.store?.doc;
    const now = performance.now();
    // a blast, a break or a critter's bark is already its own caption: its Sound isn't captioned twice
    const voiced = new Set(evs.filter((e) => e.kind === 'Detonate' || e.kind === 'Break' || e.kind === 'Bark' || e.kind === 'Burst' || e.kind === 'Pop').map((e) => e.part));
    for (const e of evs) {
      if (e.kind === 'Sound' && voiced.has(e.part)) continue;
      const p = doc?.parts.get(e.part);
      const d = p ? partDef(p.type) : undefined;
      const o = e.other !== undefined ? doc?.parts.get(e.other) : undefined; // U5 (M5): "BUZZ grabs a THUD"
      const c = captionFor(e, d?.name ?? 'PART', d?.family === 'critters' ? d.type : undefined, d?.type, o ? `a ${partDef(o.type)?.name ?? 'part'}` : undefined);
      if (!c) continue;
      const r = this.captions.push(c, e.pos, now);
      if (!r) continue;
      this.paintLine(r.line);
      if (r.fresh) announce(c.text.replace(/^\[|\]$/g, '').replace('] ', ': '));
    }
  }

  private paintLine(l: CaptionLine): void {
    let row = this.rows.get(l.id);
    if (!row) {
      row = h('<div class="cap"><span class="cap-dir"></span><span class="cap-t"></span></div>');
      this.rows.set(l.id, row);
    }
    row.classList.toggle('big', l.big);
    (row.lastElementChild as HTMLElement).textContent = lineText(l);
    this.strip.prepend(row);
    this.trim();
  }

  private trim(): void {
    const live = new Set(this.captions.lines.map((l) => l.id));
    for (const [id, r] of this.rows) if (!live.has(id)) { r.remove(); this.rows.delete(id); }
  }

  clear(): void {
    this.captions.clear();
    this.trim();
    for (const t of this.tags) t.hidden = true;
  }

  /** Per frame: caption direction marks and expiry, emote tags, port glyphs. */
  frame(now: number): void {
    const l = this.links;
    if (!l) return;
    const r = l.renderer;
    const w = r.canvas.clientWidth, ht = r.canvas.clientHeight;
    const project = (p: readonly number[]): { x: number; y: number; on: boolean } | null => {
      const c = transform(r.viewProj, p as V3);
      if (c[3] <= 0) return { x: c[0] < 0 ? w : 0, y: ht / 2, on: false }; // behind: flip side
      const x = ((c[0] / c[3]) * 0.5 + 0.5) * w, y = (1 - ((c[1] / c[3]) * 0.5 + 0.5)) * ht;
      return { x, y, on: x >= 0 && x <= w && y >= 0 && y <= ht };
    };
    // captions
    if (this.captions.lines.length) {
      if (now - this.lastExpire > 100) { this.lastExpire = now; if (this.captions.expire(now)) this.trim(); }
      for (const line of this.captions.lines) {
        const row = this.rows.get(line.id);
        const pr = project(line.pos);
        if (row && pr) (row.firstElementChild as HTMLElement).textContent = directionMark(pr.x / Math.max(1, w), pr.on);
      }
    }
    this.strip.hidden = !this.captionsOn || !this.captions.lines.length;
    this.paintTags(project);
    this.paintPorts(project);
    this.paintBuzzTags(project);
    this.paintZoneLabels(project);
  }

  /** U5 (M5): "A" / "B" chips on GRABBER's zone rings (the rings are Beam and Amber; the letters carry the meaning). */
  private paintZoneLabels(project: (p: readonly number[]) => { x: number; y: number; on: boolean } | null): void {
    const list = this.links?.zoneLabels?.() ?? [];
    let n = 0;
    for (const z of list) {
      const pr = project(z.at);
      if (!pr || !pr.on) continue;
      let chip = this.zoneChips[n];
      if (!chip) { chip = this.glyphLayer.appendChild(h('<div class="zone-chip"></div>')); this.zoneChips[n] = chip; }
      if (chip.textContent !== z.text) { chip.textContent = z.text; chip.dataset.z = z.text; }
      const bg = z.color ?? ''; // DRAG (D117): the gizmo's axis letters wear their axis colour
      if ((chip.dataset.bg ?? '') !== bg) { chip.dataset.bg = bg; chip.style.background = bg; }
      chip.style.transform = `translate(${pr.x.toFixed(1)}px, ${pr.y.toFixed(1)}px) translate(-50%, -100%)`;
      chip.hidden = false;
      n++;
    }
    for (let i = n; i < this.zoneChips.length; i++) this.zoneChips[i]!.hidden = true;
  }
  private readonly zoneChips: HTMLElement[] = [];

  /**
   * U5 (M5, D105): the tag glyph over every part tagged for BUZZ (`PartFlag.Tagged`), in Build and during a run
   * (not while BUZZ carries it). Nearest the camera first, at most MAX_BUZZ_TAGS.
   */
  private paintBuzzTags(project: (p: readonly number[]) => { x: number; y: number; on: boolean } | null): void {
    const l = this.links!;
    const doc = this.net.store?.doc;
    let n = 0;
    const bit = PartFlag.Tagged;
    if (doc && bit) {
      const running = l.run.phase === 'running';
      const carried = new Set<number>(), hunted = new Set<number>(), runTagged = new Set<number>();
      if (running) {
        const ids = l.run.partIds, c = l.run.carry, g = l.run.targets, f = l.run.flags;
        for (let i = 1; i < c.length; i += 2) { const id = ids[c[i]!]; if (id !== undefined) carried.add(id); }
        for (let i = 1; i < g.length; i += 2) { const id = ids[g[i]!]; if (id !== undefined) hunted.add(id); } // B5: the item BUZZ is after
        for (let i = 0; i < f.length; i++) if (f[i]! & PartFlagBits.tagged) runTagged.add(ids[i]!); // B5: the sim's own tagged set
      }
      const want: { at: V3; id: number; hunt: boolean }[] = [];
      for (const p of doc.parts.values()) {
        if (!(running && l.run.flags.length ? runTagged.has(p.id) : p.flags & bit) || carried.has(p.id)) continue;
        if (!running && !l.pickable(p)) continue;
        const d = partDef(p.type);
        if (!d) continue;
        const pose = running ? this.poseOfRun(p.id, 'base') : partPose(p);
        if (!pose) continue;
        want.push({ at: [pose.pos[0], pose.pos[1] + Math.max(0.02, d.bounds.max[1]) + 0.03, pose.pos[2]], id: p.id, hunt: hunted.has(p.id) });
      }
      const eye = l.renderer.eye;
      want.sort((a, b) => dist2(a.at, eye) - dist2(b.at, eye));
      for (const t of want) {
        if (n >= MAX_BUZZ_TAGS) break;
        const pr = project(t.at);
        if (!pr || !pr.on) continue;
        let chip = this.buzzTags[n];
        if (!chip) { chip = this.glyphLayer.appendChild(h(`<div class="buzz-tag">${ICON.tag}</div>`)); this.buzzTags[n] = chip; }
        chip.style.transform = `translate(${pr.x.toFixed(1)}px, ${pr.y.toFixed(1)}px) translate(-50%, -100%)`;
        chip.classList.toggle('hunt', t.hunt); // BUZZ is on its way to this one
        chip.hidden = false;
        n++;
      }
    }
    for (let i = n; i < this.buzzTags.length; i++) this.buzzTags[i]!.hidden = true;
  }
  private readonly buzzTags: HTMLElement[] = [];

  private poseOfRun(id: number, role: 'base' | 'arm'): Pose | null {
    const run = this.links!.run;
    if (run.bodies !== this.bodiesRef) {
      this.bodiesRef = run.bodies;
      this.bodyIndex.clear();
      run.bodies.forEach((b, i) => this.bodyIndex.set(`${b.part}:${b.role}`, i));
    }
    const bi = this.bodyIndex.get(`${id}:${role}`) ?? this.bodyIndex.get(`${id}:base`);
    if (bi === undefined || !run.transforms.length) return null;
    const t = run.transforms, o = bi * 7;
    return { pos: [t[o]!, t[o + 1]!, t[o + 2]!], rot: [t[o + 3]!, t[o + 4]!, t[o + 5]!, t[o + 6]!] };
  }

  /** Emote text over critters (captions on, during a run). */
  private paintTags(project: (p: readonly number[]) => { x: number; y: number; on: boolean } | null): void {
    const run = this.links!.run;
    const bytes = (run as unknown as { critters?: Uint8Array }).critters;
    let n = 0;
    if (this.captionsOn && run.phase === 'running' && bytes?.length) {
      const doc = this.net.store?.doc;
      for (let i = 0; i < run.partIds.length && n < MAX_TAGS; i++) {
        const emote = bytes[i * 4 + 2] ?? 0;
        if (!emote) continue;
        const id = run.partIds[i]!;
        const p = doc?.parts.get(id);
        const d = p ? partDef(p.type) : undefined;
        if (!d || d.family !== 'critters') continue;
        const pose = this.poseOfRun(id, 'base');
        if (!pose) continue;
        // under the critter: the emote bubble (gfx/emotes.ts) already sits over its head
        const pr = project([pose.pos[0], pose.pos[1] + (d.bounds.min[1] ?? 0) - 0.02, pose.pos[2]]);
        if (!pr || !pr.on) continue;
        const tag = this.tags[n] ?? this.tagLayer.appendChild(h('<div class="emote-tag"></div>'));
        this.tags[n] = tag;
        const text = emoteText(d.name, emote, bytes[i * 4 + 3] ?? -1); // UIFIX (D122): the FSM state ("Buzz: startled!")
        if (tag.textContent !== text) tag.textContent = text;
        tag.style.transform = `translate(${pr.x.toFixed(1)}px, ${pr.y.toFixed(1)}px) translate(-50%, 6px)`;
        tag.hidden = !text;
        n++;
      }
    }
    for (let i = n; i < this.tags.length; i++) this.tags[i]!.hidden = true;
  }

  /** Channel glyph chips on the ports the renderer is showing (Build). */
  private paintPorts(project: (p: readonly number[]) => { x: number; y: number; on: boolean } | null): void {
    const l = this.links!;
    const doc = this.net.store?.doc;
    let n = 0;
    if (settings.accessibility.portGlyphs && l.run.phase === 'build' && doc) {
      const wire = l.tool() === 'wire', xray = l.xray() !== 'off';
      const hover = l.hoverPart()?.id;
      const sel = new Set(l.selected());
      const poseOf: PoseOf = (id) => { const p = doc.parts.get(id); return p ? partPose(p) : null; };
      const want: { at: V3; ch: string; out: boolean }[] = [];
      const consider = (p: PartRecord): void => {
        const def = partDef(p.type);
        if (!def?.ports.length || !l.pickable(p)) return;
        for (const port of def.ports) {
          const at = portWorld(def, port, poseOf, p.id);
          if (at) want.push({ at, ch: port.channel, out: port.dir === 'out' });
        }
      };
      if (wire || xray) for (const p of doc.parts.values()) { consider(p); if (want.length > MAX_PORT_CHIPS * 4) break; }
      else {
        const ids = new Set<number>(sel);
        if (hover !== undefined) ids.add(hover);
        for (const id of ids) { const p = doc.parts.get(id); if (p) consider(p); }
      }
      // nearest to the camera first, so a crowded view keeps the ones you're looking at
      const eye = l.renderer.eye;
      want.sort((a, b) => dist2(a.at, eye) - dist2(b.at, eye));
      for (const wp of want) {
        if (n >= MAX_PORT_CHIPS) break;
        const pr = project(wp.at);
        if (!pr || !pr.on) continue;
        let chip = this.chips[n];
        if (!chip) { chip = this.glyphLayer.appendChild(h('<div class="port-glyph"></div>')); this.chips[n] = chip; }
        const key = `${wp.ch}:${wp.out ? 1 : 0}:${settings.accessibility.colourPreset}`;
        if (chip.dataset.k !== key) { chip.dataset.k = key; chip.innerHTML = glyph(wp.ch, 14); chip.classList.toggle('out', wp.out); }
        chip.style.transform = `translate(${(pr.x + 12).toFixed(1)}px, ${(pr.y - 12).toFixed(1)}px) translate(-50%, -50%)`;
        chip.hidden = false;
        n++;
      }
    }
    for (let i = n; i < this.chips.length; i++) this.chips[i]!.hidden = true;
  }
}

const dist2 = (a: readonly number[], b: readonly number[]): number => (a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2;
