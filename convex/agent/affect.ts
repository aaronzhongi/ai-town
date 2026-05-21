// Human-memory port (HumanMemory_AITown_Plan v2). Faithful TS rebuild of
// jynew AI Tavern Phase 3D `Affect` — RuntimeMindState.cs:48-65 (see
// docs/_jynew_phase3d_extract.md §1). Pure, lore-free, no Convex/IO.
//
// N1 — Decay math, exact:
//   Current(now) = Baseline + (Value − Baseline) · exp(−(now − LastSetMs)/HalfLifeMs)
//   guard: HalfLifeMs ≤ 0 → return Value
// Lazy (computed on read), never ticked.

export type Affect = {
  /** 平静/警惕/愤怒/喜悦/恐惧… or an affection short-hint label. */
  label: string;
  /** emotion: 0..1; affection: -1..1. */
  value: number;
  /** emotion → 0; affection → canon baseline (0 for a non-canon stranger, S3). */
  baseline: number;
  /** ms epoch when `value` was last set. */
  lastSetMs: number;
  /** decay half-life in ms; ≤ 0 disables decay. */
  halfLifeMs: number;
};

/**
 * jynew `Affect.Current(long now)` — RuntimeMindState.cs:51-56, verbatim.
 * The C# `(float)` cast is precision-only; TS `number` keeps full double
 * precision, which is acceptable (no golden vector depends on f32 rounding).
 */
export function affectCurrent(a: Affect, now: number): number {
  if (a.halfLifeMs <= 0) return a.value; // guard
  const dt = now - a.lastSetMs; // long − long → number
  return a.baseline + (a.value - a.baseline) * Math.exp(-dt / a.halfLifeMs);
}
