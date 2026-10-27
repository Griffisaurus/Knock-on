// The live governor's look steps (RENDERING §11, D79, D81): when the frame runs over budget for 2 s it
// drops the next step (light shafts → DOF → GI → internal resolution, down to 60 %); when it has
// headroom for 5 s it restores one step. It never touches the sim, Matter or anything gameplay.

export interface GovernorState {
  shafts: boolean;
  dof: boolean;
  gi: boolean;
  /** Internal resolution scale (1 … 0.6). */
  scale: number;
}

const STEPS: readonly GovernorState[] = [
  { shafts: true, dof: true, gi: true, scale: 1 },
  { shafts: false, dof: true, gi: true, scale: 1 },
  { shafts: false, dof: false, gi: true, scale: 1 },
  { shafts: false, dof: false, gi: false, scale: 1 },
  { shafts: false, dof: false, gi: false, scale: 0.9 },
  { shafts: false, dof: false, gi: false, scale: 0.8 },
  { shafts: false, dof: false, gi: false, scale: 0.7 },
  { shafts: false, dof: false, gi: false, scale: 0.6 },
];

export class Governor {
  enabled = true;
  /** Frame budget (ms): 60 fps. */
  budget = 16.6;
  level = 0;
  private over = 0;
  private under = 0;
  private ema = 0;

  get state(): GovernorState { return STEPS[this.level]!; }

  /** Feed one frame's time (ms; GPU time when available, else the frame interval). Returns true on a change. */
  update(frameMs: number, dtS: number): boolean {
    if (!this.enabled || !Number.isFinite(frameMs) || frameMs <= 0) return false;
    this.ema = this.ema ? this.ema * 0.9 + frameMs * 0.1 : frameMs;
    if (this.ema > this.budget * 1.05) { this.over += dtS; this.under = 0; } else if (this.ema < this.budget * 0.8) { this.under += dtS; this.over = 0; } else { this.over = 0; this.under = 0; }
    if (this.over >= 2 && this.level < STEPS.length - 1) { this.level++; this.over = 0; this.ema = 0; return true; }
    if (this.under >= 5 && this.level > 0) { this.level--; this.under = 0; this.ema = 0; return true; }
    return false;
  }

  reset(): void { this.level = 0; this.over = 0; this.under = 0; this.ema = 0; }
}
