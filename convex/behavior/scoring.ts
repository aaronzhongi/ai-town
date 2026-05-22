// Memory v3.5 — behavioral-test scoring + calibration math.
//
// Pure logic. No Convex imports. Consumes B1's `LifecycleResult` plus
// the existing judge's `JudgeResult` and produces:
//
//   - `ScenarioVerdict` (per-scenario pass/fail/skipped/error)
//   - `SelfAgreement` (per-bullet + per-scenario across N judge runs)
//   - `CalibrationEntry` (the persisted state for a given scenario)
//
// Aggregation order is DELIBERATELY {error → rubric-fail → det-fail →
// unverifiable-skipped → pass} per Plan-Lens 1 BLOCKING #1: the rubric
// is the authoritative signal when it speaks. B06 is the load-bearing
// case here — its `expectedAction: walk-away` is permanently UNVERIFIABLE
// (no action-log table yet, P6 deferred), but if the rubric `mustNot`
// fires (NPC says "好吧" trusting the assailant) the scenario MUST fail,
// not skip.
//
// Calibration metric is per Plan-Lens 1 BLOCKING #2: rather than averaging
// majority-counts (which collapses at N=3), each bullet is scored
// pass/fail at a tunable agreement threshold and `perBullet` reports the
// fraction of bullets that passed. Default N=5; default per-bullet
// agreement threshold = 0.8; default gate threshold = 0.9.

import type { Scenario } from './parseScenarios';
import type { JudgeResult, BulletVerdict } from './judge';
import type { LifecycleResult, MindStateSnapshot } from './lifecycle';

// ─────────────────────────────────────────────────────────────────────
// Magnitude bands (extracted constants — Plan-Lens 1 IMPORTANT #4)
// ─────────────────────────────────────────────────────────────────────

/** |Δ| below this is considered "zero / no change" for affect deltas.
 *  Matches `N24_REFIRE_PERF_FLOOR = 0.05` in convex/constants.ts
 *  deliberately — affect deltas below that floor don't propagate to
 *  mindState in production (the N24 re-fire path skips them), so a
 *  scoring band that treats them as zero matches production semantics. */
export const AFFECT_DELTA_ZERO_THRESHOLD = 0.05;
/** |Δ| upper bound for "small" magnitude. */
export const AFFECT_DELTA_SMALL_MAX = 0.5;
/** |Δ| upper bound for "medium" magnitude. Anything ≥ this is "large". */
export const AFFECT_DELTA_MEDIUM_MAX = 1.0;

// ─────────────────────────────────────────────────────────────────────
// Calibration gate thresholds (Plan-Lens 1 BLOCKING #2)
// ─────────────────────────────────────────────────────────────────────

/** Default N for calibration runs. N=3 was too low (the per-bullet
 *  metric collapses to "all-or-2/3" which fails most multi-bullet
 *  rubrics). N=5 gives meaningful resolution at the 0.9 gate. */
export const CALIBRATION_DEFAULT_N = 5;

/** A bullet is "agreed-upon" if its majority verdict appears in at
 *  least this fraction of the N judge runs. Default 0.8 means: 4 of 5
 *  (or 5 of 6, or 7 of 8) must agree. */
export const BULLET_AGREEMENT_THRESHOLD = 0.8;

/** Gate threshold for perBulletAgreement (fraction of bullets that
 *  cleared `BULLET_AGREEMENT_THRESHOLD`). Borrowed from the methodology
 *  note's [PLACEHOLDER] 0.9 — revisit once we have real distribution
 *  data from the first nightly run. */
export const GATE_PER_BULLET_THRESHOLD = 0.9;

/** Gate threshold for perScenarioAgreement (fraction of N runs whose
 *  overall pass/fail matches the majority). */
export const GATE_PER_SCENARIO_THRESHOLD = 0.9;

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type DeterministicCheckName =
  | 'affectionDelta'
  | 'emotionValueMin'
  | 'emotionValueMax'
  | 'expectedAction'
  | 'npcViolenceUsed';

export type DeterministicCheckStatus = 'pass' | 'fail' | 'unverifiable';

export type DeterministicCheckVerdict = {
  name: DeterministicCheckName;
  status: DeterministicCheckStatus;
  /** Human-readable summary of what was expected. */
  expected: string;
  /** Human-readable summary of what was observed; null/undefined on
   *  unverifiable. */
  actual?: string;
  /** Why this check is unverifiable. Populated only when
   *  status='unverifiable'. */
  reason?: 'no-action-log' | 'op-a-crashed' | 'no-mindstate-row';
};

export type ScenarioVerdictOverall = 'pass' | 'fail' | 'skipped' | 'error';

export type ScenarioVerdict = {
  scenarioId: string;
  overall: ScenarioVerdictOverall;
  /** Human-readable reason; set when overall != 'pass'. */
  reason?: string;
  /** Source of the error when overall='error': 'lifecycle' (B1) or
   *  'judge' (B2 — judge call threw/HTTP/parse). */
  errorSource?: 'lifecycle' | 'judge';
  /** Rubric judge run. Single run for scored mode; one of N for
   *  calibration mode (calibration captures full array separately). */
  rubric?: JudgeResult;
  /** Deterministic check evaluation. */
  deterministic: {
    checks: DeterministicCheckVerdict[];
    anyUnverifiable: boolean;
    anyFailed: boolean;
  };
  /** Lifecycle's opAFailuresObserved (pre + post), copied through so a
   *  consumer doesn't need to also carry LifecycleResult. */
  opAFailures?: {
    pre: { failed: number; canceled: number };
    post: { failed: number; canceled: number };
  };
};

/** One bullet's agreement across N judge runs. */
export type BulletAgreement = {
  tier: BulletVerdict['tier'];
  bullet: string;
  /** Number of runs where the majority verdict appeared. */
  majorityCount: number;
  /** majorityCount / N */
  agreement: number;
  /** True iff agreement >= BULLET_AGREEMENT_THRESHOLD. */
  passes: boolean;
};

export type SelfAgreement = {
  n: number;
  perBullet: number;
  perScenario: number;
  bulletBreakdown: BulletAgreement[];
};

/** What the runner persists per scenario into calibration-state.json. */
export type CalibrationEntry = {
  /** ISO timestamp of the last calibration run. */
  lastCalibratedAt: string;
  /** Number of judge runs used. */
  n: number;
  /** Self-agreement metrics. */
  perBulletAgreement: number;
  perScenarioAgreement: number;
  /** Does this scenario currently pass the gate? */
  passesGate: boolean;
  /** Why the gate fails (only set when passesGate=false). */
  blockedReason?: string;
  /** Judge model used. Calibration done with model X is not evidence
   *  for production runs with model Y. */
  judgeModel: string;
  /** SHA-256 hash of the canonicalized rubric. Drift detection
   *  (Plan-Lens 1 BLOCKING #3): if the YAML rubric changes, the stored
   *  hash will mismatch and the scenario is treated as not-gated. */
  rubricHash: string;
  /** Free-text notes (e.g., "blocked on P6 action log"). */
  notes?: string;
};

export type CalibrationState = {
  version: 1;
  generated?: string;
  scenarios: Record<string, CalibrationEntry>;
};

// ─────────────────────────────────────────────────────────────────────
// Rubric hash (Plan-Lens 1 BLOCKING #3)
// ─────────────────────────────────────────────────────────────────────

/** Canonicalize the rubric: sort keys, normalize whitespace inside
 *  bullets, then hash. Two rubrics that judge-identically must have
 *  the same hash. Reordering bullets DOES change the hash (judges read
 *  the order). */
export function canonicalizeRubricForHashing(rubric: Scenario['rubric']): string {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const obj: Record<string, string[]> = {
    must: rubric.must.map(norm),
  };
  if (rubric.should) obj.should = rubric.should.map(norm);
  if (rubric.mustNot) obj.mustNot = rubric.mustNot.map(norm);
  // Stable key order.
  return JSON.stringify(obj, ['must', 'should', 'mustNot']);
}

/** Compute a SHA-256 hex hash of the canonicalized rubric. Uses the
 *  Web Crypto API (available in both Node 16+ and Convex isolates).
 *  Pure async function. */
export async function hashRubric(rubric: Scenario['rubric']): Promise<string> {
  const text = canonicalizeRubricForHashing(rubric);
  const data = new TextEncoder().encode(text);
  const digest = await (globalThis.crypto?.subtle ?? require('node:crypto').webcrypto.subtle).digest(
    'SHA-256',
    data,
  );
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

// ─────────────────────────────────────────────────────────────────────
// Deterministic check evaluation
// ─────────────────────────────────────────────────────────────────────

/** Classify a delta into (sign, magnitude) per the AFFECT_DELTA_* bands.
 *  Magnitudes are: 'small' [zero, small_max), 'medium' [small_max,
 *  medium_max), 'large' [medium_max, ∞). Sign 'zero' iff |Δ| < zero
 *  threshold. */
export function classifyDelta(
  delta: number,
): { sign: 'positive' | 'negative' | 'zero'; magnitude: 'small' | 'medium' | 'large' } {
  const abs = Math.abs(delta);
  const sign = abs < AFFECT_DELTA_ZERO_THRESHOLD ? 'zero' : delta > 0 ? 'positive' : 'negative';
  const magnitude =
    abs < AFFECT_DELTA_SMALL_MAX ? 'small' : abs < AFFECT_DELTA_MEDIUM_MAX ? 'medium' : 'large';
  return { sign, magnitude };
}

/** Evaluate all deterministic checks in `scenario.deterministic`. */
export function evaluateDeterministic(
  scenario: Scenario,
  pre: MindStateSnapshot,
  post: MindStateSnapshot,
  opAFailures: { pre: { failed: number; canceled: number }; post: { failed: number; canceled: number } },
): DeterministicCheckVerdict[] {
  const det = scenario.deterministic;
  if (!det) return [];
  const checks: DeterministicCheckVerdict[] = [];

  // Op A pre/post invalidation rule (Plan-Lens 1 IMPORTANT #5).
  // A mindState-reading check is unverifiable iff the post-snapshot
  // is suspect (op-a-crashed during the POST quiescence wait, OR
  // post-snapshot row missing entirely).
  const postOpACrashed = opAFailures.post.failed > 0;

  // affectionDelta
  if (det.affectionDelta) {
    const exp = det.affectionDelta;
    const expectedStr = `sign=${exp.sign}, magnitude=${exp.magnitude}`;
    if (postOpACrashed) {
      checks.push({
        name: 'affectionDelta',
        status: 'unverifiable',
        expected: expectedStr,
        reason: 'op-a-crashed',
      });
    } else if (post === null) {
      checks.push({
        name: 'affectionDelta',
        status: 'unverifiable',
        expected: expectedStr,
        reason: 'no-mindstate-row',
      });
    } else {
      const preVal = pre?.affectionValue ?? 0;
      const postVal = post.affectionValue ?? 0;
      const delta = postVal - preVal;
      const classified = classifyDelta(delta);
      const actualStr = `Δ=${delta.toFixed(3)} (sign=${classified.sign}, magnitude=${classified.magnitude})`;
      const pass = classified.sign === exp.sign && classified.magnitude === exp.magnitude;
      checks.push({
        name: 'affectionDelta',
        status: pass ? 'pass' : 'fail',
        expected: expectedStr,
        actual: actualStr,
      });
    }
  }

  // emotionValueMin / Max — both read post.emotionValue.
  for (const bound of ['emotionValueMin', 'emotionValueMax'] as const) {
    const expected = det[bound];
    if (expected === undefined) continue;
    const expectedStr = `emotion.value ${bound === 'emotionValueMin' ? '≥' : '≤'} ${expected}`;
    if (postOpACrashed) {
      checks.push({ name: bound, status: 'unverifiable', expected: expectedStr, reason: 'op-a-crashed' });
      continue;
    }
    const observed = post?.emotionValue;
    if (observed === null || observed === undefined) {
      checks.push({ name: bound, status: 'unverifiable', expected: expectedStr, reason: 'no-mindstate-row' });
      continue;
    }
    const pass = bound === 'emotionValueMin' ? observed >= expected : observed <= expected;
    checks.push({
      name: bound,
      status: pass ? 'pass' : 'fail',
      expected: expectedStr,
      actual: `emotion.value=${observed.toFixed(3)}`,
    });
  }

  // expectedAction — ALWAYS unverifiable (no action-log table, P6).
  if (det.expectedAction) {
    checks.push({
      name: 'expectedAction',
      status: 'unverifiable',
      expected: `body-action=${det.expectedAction}`,
      reason: 'no-action-log',
    });
  }

  // npcViolenceUsed — ALWAYS unverifiable (same P6 root cause).
  if (det.npcViolenceUsed !== undefined) {
    checks.push({
      name: 'npcViolenceUsed',
      status: 'unverifiable',
      expected: `npcViolenceUsed=${det.npcViolenceUsed}`,
      reason: 'no-action-log',
    });
  }

  return checks;
}

// ─────────────────────────────────────────────────────────────────────
// Scenario aggregation
// ─────────────────────────────────────────────────────────────────────

/** Aggregate the per-scenario verdict from a single lifecycle run +
 *  single judge run. Order (Plan-Lens 1 BLOCKING #1):
 *    1. lifecycle error → error
 *    2. judge error → error
 *    3. rubric mustFail>0 OR mustNotFail>0 → fail
 *    4. any deterministic check failed → fail
 *    5. any deterministic check unverifiable → skipped
 *    6. else → pass
 */
export function aggregateScenarioVerdict(
  scenario: Scenario,
  lifecycleResult: LifecycleResult,
  judgeResult: JudgeResult | null,
  judgeError: Error | null,
): ScenarioVerdict {
  const opAFailures = lifecycleResult.opAFailuresObserved
    ? {
        pre: lifecycleResult.opAFailuresObserved.pre ?? { failed: 0, canceled: 0 },
        post: lifecycleResult.opAFailuresObserved.post ?? { failed: 0, canceled: 0 },
      }
    : { pre: { failed: 0, canceled: 0 }, post: { failed: 0, canceled: 0 } };

  // 1. lifecycle error
  if (lifecycleResult.status === 'error') {
    return {
      scenarioId: scenario.id,
      overall: 'error',
      errorSource: 'lifecycle',
      reason: `lifecycle ${lifecycleResult.error?.step}: ${lifecycleResult.error?.message}`,
      deterministic: { checks: [], anyUnverifiable: false, anyFailed: false },
      opAFailures,
    };
  }
  // 2. judge error
  if (judgeError) {
    return {
      scenarioId: scenario.id,
      overall: 'error',
      errorSource: 'judge',
      reason: `judge call failed: ${judgeError.message}`,
      deterministic: { checks: [], anyUnverifiable: false, anyFailed: false },
      opAFailures,
    };
  }

  const detChecks = evaluateDeterministic(
    scenario,
    lifecycleResult.preMindState ?? null,
    lifecycleResult.postMindState ?? null,
    opAFailures,
  );
  const anyUnverifiable = detChecks.some((c) => c.status === 'unverifiable');
  const anyFailed = detChecks.some((c) => c.status === 'fail');

  // 3. rubric mustFail / mustNotFail (B06 honesty fix).
  // Defensive: lifecycle contract guarantees status='ok' implies
  // npcReply present, which implies judgeResult or judgeError. If
  // both are null here (contract violation), short-circuit to error
  // rather than crashing on r.mustFail (Lens-A NIT #1).
  if (!judgeResult) {
    return {
      scenarioId: scenario.id,
      overall: 'error',
      errorSource: 'lifecycle',
      reason: 'lifecycle returned status=ok but no judge result was produced (contract violation)',
      deterministic: { checks: [], anyUnverifiable: false, anyFailed: false },
      opAFailures,
    };
  }
  const r = judgeResult;
  if (r.mustFail > 0 || r.mustNotFail > 0) {
    const failedBullets = r.verdicts
      .filter((v) => !v.pass && (v.tier === 'must' || v.tier === 'mustNot'))
      .map((v) => `[${v.tier}] "${v.bullet}"`);
    return {
      scenarioId: scenario.id,
      overall: 'fail',
      reason: `rubric ${r.mustFail > 0 ? 'MUST' : 'MUST NOT'} failure: ${failedBullets.join('; ')}`,
      rubric: r,
      deterministic: { checks: detChecks, anyUnverifiable, anyFailed },
      opAFailures,
    };
  }

  // 4. deterministic failed
  if (anyFailed) {
    const failed = detChecks.filter((c) => c.status === 'fail').map((c) => c.name);
    return {
      scenarioId: scenario.id,
      overall: 'fail',
      reason: `deterministic check(s) failed: ${failed.join(', ')}`,
      rubric: r,
      deterministic: { checks: detChecks, anyUnverifiable, anyFailed },
      opAFailures,
    };
  }

  // 5. deterministic unverifiable → skipped
  if (anyUnverifiable) {
    const unver = detChecks
      .filter((c) => c.status === 'unverifiable')
      .map((c) => `${c.name} (${c.reason})`);
    return {
      scenarioId: scenario.id,
      overall: 'skipped',
      reason: `deterministic check(s) unverifiable: ${unver.join(', ')}`,
      rubric: r,
      deterministic: { checks: detChecks, anyUnverifiable, anyFailed },
      opAFailures,
    };
  }

  // 6. pass
  return {
    scenarioId: scenario.id,
    overall: 'pass',
    rubric: r,
    deterministic: { checks: detChecks, anyUnverifiable, anyFailed },
    opAFailures,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Self-agreement (calibration)
// ─────────────────────────────────────────────────────────────────────

/** Compute self-agreement across N judge runs of the same reply against
 *  the same rubric. Per Plan-Lens 1 BLOCKING #2, both metrics are
 *  reported and gating uses BOTH:
 *
 *  - perBullet = (# bullets whose majority verdict appears in at least
 *    BULLET_AGREEMENT_THRESHOLD fraction of runs) / total bullets.
 *  - perScenario = (# runs whose overall `passed` matches the mode) / N.
 *
 *  All judge runs MUST share the same bullet positions (same rubric).
 */
export function computeSelfAgreement(judgeRuns: JudgeResult[]): SelfAgreement {
  const n = judgeRuns.length;
  if (n === 0) {
    return { n: 0, perBullet: 0, perScenario: 0, bulletBreakdown: [] };
  }
  // All runs should have the same bullet count + order.
  const firstRunVerdicts = judgeRuns[0].verdicts;
  const numBullets = firstRunVerdicts.length;
  const bulletBreakdown: BulletAgreement[] = [];

  for (let i = 0; i < numBullets; i++) {
    const ref = firstRunVerdicts[i];
    let passCount = 0;
    let failCount = 0;
    for (const run of judgeRuns) {
      const v = run.verdicts[i];
      if (!v) continue; // defensive — shouldn't happen if rubric same
      if (v.pass) passCount++;
      else failCount++;
    }
    const majorityCount = Math.max(passCount, failCount);
    const agreement = majorityCount / n;
    bulletBreakdown.push({
      tier: ref.tier,
      bullet: ref.bullet,
      majorityCount,
      agreement,
      passes: agreement >= BULLET_AGREEMENT_THRESHOLD,
    });
  }

  const perBullet =
    bulletBreakdown.length === 0
      ? 1.0
      : bulletBreakdown.filter((b) => b.passes).length / bulletBreakdown.length;

  // perScenario: fraction of runs whose overall passed matches the mode.
  let passedRuns = 0;
  let failedRuns = 0;
  for (const r of judgeRuns) {
    if (r.passed) passedRuns++;
    else failedRuns++;
  }
  const majorityScenario = Math.max(passedRuns, failedRuns);
  const perScenario = majorityScenario / n;

  return { n, perBullet, perScenario, bulletBreakdown };
}

/** Construct a CalibrationEntry from the inputs. `passesGate` is true
 *  iff BOTH self-agreement metrics ≥ their gate thresholds AND the
 *  most recent verdict had no UNVERIFIABLE deterministic checks AND
 *  no Op A failures landed on the post-reply snapshot. */
export function buildCalibrationEntry(args: {
  selfAgreement: SelfAgreement;
  latestVerdict: ScenarioVerdict;
  judgeModel: string;
  rubricHash: string;
  now?: Date;
}): CalibrationEntry {
  const { selfAgreement, latestVerdict, judgeModel, rubricHash } = args;
  const now = (args.now ?? new Date()).toISOString();

  const reasons: string[] = [];
  if (selfAgreement.perBullet < GATE_PER_BULLET_THRESHOLD) {
    reasons.push(`perBullet=${selfAgreement.perBullet.toFixed(2)} < gate ${GATE_PER_BULLET_THRESHOLD}`);
  }
  if (selfAgreement.perScenario < GATE_PER_SCENARIO_THRESHOLD) {
    reasons.push(`perScenario=${selfAgreement.perScenario.toFixed(2)} < gate ${GATE_PER_SCENARIO_THRESHOLD}`);
  }
  if (latestVerdict.deterministic.anyUnverifiable) {
    const unver = latestVerdict.deterministic.checks
      .filter((c) => c.status === 'unverifiable')
      .map((c) => `${c.name}(${c.reason})`)
      .join(', ');
    reasons.push(`unverifiable deterministic checks: ${unver}`);
  }
  const postFailed = latestVerdict.opAFailures?.post.failed ?? 0;
  if (postFailed > 0) {
    reasons.push(`opA post-reply failures: ${postFailed}`);
  }

  return {
    lastCalibratedAt: now,
    n: selfAgreement.n,
    perBulletAgreement: selfAgreement.perBullet,
    perScenarioAgreement: selfAgreement.perScenario,
    passesGate: reasons.length === 0,
    blockedReason: reasons.length === 0 ? undefined : reasons.join('; '),
    judgeModel,
    rubricHash,
  };
}

/** Merge a fresh calibration entry into an existing CalibrationState.
 *  Only writes when something material changed (passesGate flipped OR
 *  rubricHash changed OR scenario absent) — Plan-Lens 1 IMPORTANT #5:
 *  avoids noisy commits where only the timestamp would change.
 *  Returns { state, changed } so the caller can skip the disk write. */
export function mergeCalibrationEntry(
  state: CalibrationState,
  scenarioId: string,
  fresh: CalibrationEntry,
): { state: CalibrationState; changed: boolean } {
  const existing = state.scenarios[scenarioId];
  const changed =
    !existing ||
    existing.passesGate !== fresh.passesGate ||
    existing.rubricHash !== fresh.rubricHash ||
    existing.blockedReason !== fresh.blockedReason ||
    existing.judgeModel !== fresh.judgeModel ||
    existing.n !== fresh.n ||
    Math.abs(existing.perBulletAgreement - fresh.perBulletAgreement) > 0.01 ||
    Math.abs(existing.perScenarioAgreement - fresh.perScenarioAgreement) > 0.01;
  if (!changed) {
    return { state, changed: false };
  }
  const newState: CalibrationState = {
    ...state,
    generated: new Date().toISOString(),
    scenarios: { ...state.scenarios, [scenarioId]: fresh },
  };
  return { state: newState, changed: true };
}

/** Given an existing calibration entry and the current rubric, decide
 *  whether the entry is still valid (rubricHash matches). If not,
 *  return a new entry with passesGate=false and blockedReason set to
 *  rubric-drift. Use this on READ — drift invalidates regardless of
 *  the stored `passesGate` flag. */
export function invalidateOnRubricDrift(
  entry: CalibrationEntry,
  currentRubricHash: string,
): CalibrationEntry {
  if (entry.rubricHash === currentRubricHash) return entry;
  return {
    ...entry,
    passesGate: false,
    blockedReason: `rubric-changed-since-calibration (stored=${entry.rubricHash.slice(0, 8)}, current=${currentRubricHash.slice(0, 8)})`,
  };
}
