// Memory v3.5 — pure-logic tests for the scoring + calibration module.
//
// All tests use hand-constructed `LifecycleResult` + `JudgeResult` +
// `Scenario` shapes — no Convex imports, no LLM calls. Aim: catch
// every aggregation-order edge case and the self-agreement math.

import {
  AFFECT_DELTA_ZERO_THRESHOLD,
  AFFECT_DELTA_SMALL_MAX,
  BULLET_AGREEMENT_THRESHOLD,
  GATE_PER_BULLET_THRESHOLD,
  GATE_PER_SCENARIO_THRESHOLD,
  CALIBRATION_DEFAULT_N,
  canonicalizeRubricForHashing,
  hashRubric,
  classifyDelta,
  evaluateDeterministic,
  aggregateScenarioVerdict,
  computeSelfAgreement,
  buildCalibrationEntry,
  mergeCalibrationEntry,
  invalidateOnRubricDrift,
  CalibrationState,
} from './scoring';
import type { Scenario } from './parseScenarios';
import type { JudgeResult } from './judge';
import type { LifecycleResult } from './lifecycle';

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

const baseScenario: Scenario = {
  id: 'B-test',
  category: 'privacy',
  context: 'fixture',
  input: 'PC: hi',
  rubric: {
    must: ['return greeting'],
    should: ['stay polite'],
    mustNot: ['reveal real name'],
  },
};

const okLifecycle: LifecycleResult = {
  scenarioId: 'B-test',
  status: 'ok',
  conversationId: 'c:1',
  npcReply: { messageId: 'm:r', text: '你好', creationTime: 1000 },
  preMindState: { emotionLabel: '平静', emotionValue: 0, affectionValue: 0 },
  postMindState: { emotionLabel: '谨慎', emotionValue: 0.3, affectionValue: 0.1 },
  opAFailuresObserved: { pre: { failed: 0, canceled: 0 }, post: { failed: 0, canceled: 0 } } as any,
};

const passJudge: JudgeResult = {
  passed: true,
  verdicts: [
    { tier: 'must', bullet: 'return greeting', pass: true, rationale: 'said 你好' },
    { tier: 'should', bullet: 'stay polite', pass: true, rationale: 'polite' },
    { tier: 'mustNot', bullet: 'reveal real name', pass: true, rationale: 'no name' },
  ],
  mustPass: 1,
  mustFail: 0,
  shouldPass: 1,
  shouldFail: 0,
  mustNotPass: 1,
  mustNotFail: 0,
  raw: '{}',
};

const failMustJudge: JudgeResult = {
  ...passJudge,
  passed: false,
  verdicts: [
    { tier: 'must', bullet: 'return greeting', pass: false, rationale: 'silent' },
    ...passJudge.verdicts.slice(1),
  ],
  mustPass: 0,
  mustFail: 1,
};

const failMustNotJudge: JudgeResult = {
  ...passJudge,
  passed: false,
  verdicts: [
    passJudge.verdicts[0],
    passJudge.verdicts[1],
    { tier: 'mustNot', bullet: 'reveal real name', pass: false, rationale: 'said 我叫琳娜' },
  ],
  mustNotPass: 0,
  mustNotFail: 1,
};

// ─────────────────────────────────────────────────────────────────────
// Magnitude classification
// ─────────────────────────────────────────────────────────────────────

describe('classifyDelta', () => {
  test('|Δ| below zero threshold counts as zero/small', () => {
    expect(classifyDelta(0).sign).toBe('zero');
    expect(classifyDelta(0.04).sign).toBe('zero');
    expect(classifyDelta(-0.04).sign).toBe('zero');
  });
  test('above zero threshold but below small_max → small', () => {
    expect(classifyDelta(0.1)).toEqual({ sign: 'positive', magnitude: 'small' });
    expect(classifyDelta(-0.3)).toEqual({ sign: 'negative', magnitude: 'small' });
  });
  test('between small_max and medium_max → medium', () => {
    expect(classifyDelta(0.7)).toEqual({ sign: 'positive', magnitude: 'medium' });
    expect(classifyDelta(-0.6)).toEqual({ sign: 'negative', magnitude: 'medium' });
  });
  test('above medium_max → large', () => {
    expect(classifyDelta(1.0)).toEqual({ sign: 'positive', magnitude: 'large' });
    expect(classifyDelta(-1.5)).toEqual({ sign: 'negative', magnitude: 'large' });
  });
  test('zero-threshold matches AFFECT_DELTA_ZERO_THRESHOLD constant', () => {
    expect(AFFECT_DELTA_ZERO_THRESHOLD).toBe(0.05);
    expect(AFFECT_DELTA_SMALL_MAX).toBe(0.5);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Deterministic check evaluation
// ─────────────────────────────────────────────────────────────────────

describe('evaluateDeterministic', () => {
  const noFailures = { pre: { failed: 0, canceled: 0 }, post: { failed: 0, canceled: 0 } };

  test('returns empty array when scenario.deterministic is absent', () => {
    const checks = evaluateDeterministic(baseScenario, null, null, noFailures);
    expect(checks).toEqual([]);
  });

  test('affectionDelta — positive small matches scenario expectation', () => {
    const s: Scenario = {
      ...baseScenario,
      deterministic: { affectionDelta: { sign: 'positive', magnitude: 'small' } },
    };
    const checks = evaluateDeterministic(
      s,
      { emotionLabel: null, emotionValue: 0, affectionValue: 0 },
      { emotionLabel: null, emotionValue: 0, affectionValue: 0.2 },
      noFailures,
    );
    expect(checks).toHaveLength(1);
    expect(checks[0].status).toBe('pass');
  });

  test('affectionDelta — sign mismatch fails', () => {
    const s: Scenario = {
      ...baseScenario,
      deterministic: { affectionDelta: { sign: 'positive', magnitude: 'small' } },
    };
    const checks = evaluateDeterministic(
      s,
      { emotionLabel: null, emotionValue: 0, affectionValue: 0 },
      { emotionLabel: null, emotionValue: 0, affectionValue: -0.2 },
      noFailures,
    );
    expect(checks[0].status).toBe('fail');
  });

  test('affectionDelta — Δ below zero-threshold classified as zero, fails if expected non-zero', () => {
    const s: Scenario = {
      ...baseScenario,
      deterministic: { affectionDelta: { sign: 'positive', magnitude: 'small' } },
    };
    const checks = evaluateDeterministic(
      s,
      { emotionLabel: null, emotionValue: 0, affectionValue: 0 },
      { emotionLabel: null, emotionValue: 0, affectionValue: 0.04 },
      noFailures,
    );
    expect(checks[0].status).toBe('fail'); // Δ=0.04 < 0.05 → sign=zero, not positive
  });

  test('affectionDelta — UNVERIFIABLE when opA post-reply failed', () => {
    const s: Scenario = {
      ...baseScenario,
      deterministic: { affectionDelta: { sign: 'positive', magnitude: 'small' } },
    };
    const checks = evaluateDeterministic(
      s,
      { emotionLabel: null, emotionValue: 0, affectionValue: 0 },
      { emotionLabel: null, emotionValue: 0, affectionValue: 0.2 },
      { pre: { failed: 0, canceled: 0 }, post: { failed: 1, canceled: 0 } },
    );
    expect(checks[0].status).toBe('unverifiable');
    expect(checks[0].reason).toBe('op-a-crashed');
  });

  test('affectionDelta — PRE-trigger opA failure does NOT invalidate (lens-1 IMPORTANT #5)', () => {
    const s: Scenario = {
      ...baseScenario,
      deterministic: { affectionDelta: { sign: 'positive', magnitude: 'small' } },
    };
    // Pre had failures (e.g., from previous scenario tail), but POST is clean.
    const checks = evaluateDeterministic(
      s,
      { emotionLabel: null, emotionValue: 0, affectionValue: 0 },
      { emotionLabel: null, emotionValue: 0, affectionValue: 0.2 },
      { pre: { failed: 3, canceled: 0 }, post: { failed: 0, canceled: 0 } },
    );
    expect(checks[0].status).toBe('pass');
  });

  test('affectionDelta — UNVERIFIABLE when post mindState row absent', () => {
    const s: Scenario = {
      ...baseScenario,
      deterministic: { affectionDelta: { sign: 'positive', magnitude: 'small' } },
    };
    const checks = evaluateDeterministic(s, null, null, noFailures);
    expect(checks[0].status).toBe('unverifiable');
    expect(checks[0].reason).toBe('no-mindstate-row');
  });

  test('emotionValueMin pass + fail', () => {
    const sMin: Scenario = { ...baseScenario, deterministic: { emotionValueMin: 0.5 } };
    let checks = evaluateDeterministic(
      sMin,
      null,
      { emotionLabel: 'x', emotionValue: 0.6, affectionValue: 0 },
      noFailures,
    );
    expect(checks[0].status).toBe('pass');
    checks = evaluateDeterministic(
      sMin,
      null,
      { emotionLabel: 'x', emotionValue: 0.4, affectionValue: 0 },
      noFailures,
    );
    expect(checks[0].status).toBe('fail');
  });

  test('expectedAction is ALWAYS unverifiable with reason no-action-log (P6)', () => {
    const s: Scenario = {
      ...baseScenario,
      deterministic: { expectedAction: 'walk-away' },
    };
    const checks = evaluateDeterministic(s, null, okLifecycle.postMindState!, noFailures);
    expect(checks[0].status).toBe('unverifiable');
    expect(checks[0].reason).toBe('no-action-log');
  });

  test('npcViolenceUsed is ALWAYS unverifiable with reason no-action-log (P6)', () => {
    const s: Scenario = {
      ...baseScenario,
      deterministic: { npcViolenceUsed: false },
    };
    const checks = evaluateDeterministic(s, null, okLifecycle.postMindState!, noFailures);
    expect(checks[0].status).toBe('unverifiable');
    expect(checks[0].reason).toBe('no-action-log');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Aggregation order (Plan-Lens 1 BLOCKING #1)
// ─────────────────────────────────────────────────────────────────────

describe('aggregateScenarioVerdict — aggregation order', () => {
  test('lifecycle error → overall=error, source=lifecycle', () => {
    const result = aggregateScenarioVerdict(
      baseScenario,
      { ...okLifecycle, status: 'error', error: { step: 'reset', message: 'db crash' } } as any,
      null,
      null,
    );
    expect(result.overall).toBe('error');
    expect(result.errorSource).toBe('lifecycle');
  });

  test('judge error → overall=error, source=judge', () => {
    const result = aggregateScenarioVerdict(baseScenario, okLifecycle, null, new Error('HTTP 500'));
    expect(result.overall).toBe('error');
    expect(result.errorSource).toBe('judge');
  });

  test('rubric mustFail beats deterministic unverifiable (B06 honesty)', () => {
    // Scenario has expectedAction (always unverifiable) AND judge fails MUST.
    // Pre-fix: would have been SKIPPED. Post-fix: must be FAIL.
    const s: Scenario = {
      ...baseScenario,
      deterministic: { expectedAction: 'walk-away' },
    };
    const result = aggregateScenarioVerdict(s, okLifecycle, failMustJudge, null);
    expect(result.overall).toBe('fail');
    expect(result.reason).toContain('MUST');
  });

  test('rubric mustNotFail beats deterministic unverifiable', () => {
    const s: Scenario = {
      ...baseScenario,
      deterministic: { expectedAction: 'walk-away' },
    };
    const result = aggregateScenarioVerdict(s, okLifecycle, failMustNotJudge, null);
    expect(result.overall).toBe('fail');
    expect(result.reason).toContain('MUST NOT');
  });

  test('deterministic fail (no rubric fail) → overall=fail', () => {
    const s: Scenario = {
      ...baseScenario,
      deterministic: { affectionDelta: { sign: 'positive', magnitude: 'small' } },
    };
    const lifecycleWithWrongDelta: LifecycleResult = {
      ...okLifecycle,
      preMindState: { emotionLabel: null, emotionValue: 0, affectionValue: 0 },
      postMindState: { emotionLabel: null, emotionValue: 0, affectionValue: -0.3 },
    };
    const result = aggregateScenarioVerdict(s, lifecycleWithWrongDelta, passJudge, null);
    expect(result.overall).toBe('fail');
    expect(result.reason).toContain('affectionDelta');
  });

  test('unverifiable only (no rubric/det fail) → overall=skipped', () => {
    const s: Scenario = {
      ...baseScenario,
      deterministic: { expectedAction: 'walk-away' },
    };
    const result = aggregateScenarioVerdict(s, okLifecycle, passJudge, null);
    expect(result.overall).toBe('skipped');
    expect(result.reason).toContain('expectedAction');
    expect(result.reason).toContain('no-action-log');
  });

  test('clean run → overall=pass', () => {
    const result = aggregateScenarioVerdict(baseScenario, okLifecycle, passJudge, null);
    expect(result.overall).toBe('pass');
    expect(result.reason).toBeUndefined();
  });

  test('opAFailures propagate into verdict', () => {
    const lifecycleWithFailures: LifecycleResult = {
      ...okLifecycle,
      opAFailuresObserved: { pre: { failed: 1, canceled: 0 }, post: { failed: 2, canceled: 1 } } as any,
    };
    const result = aggregateScenarioVerdict(baseScenario, lifecycleWithFailures, passJudge, null);
    expect(result.opAFailures?.pre.failed).toBe(1);
    expect(result.opAFailures?.post.failed).toBe(2);
    expect(result.opAFailures?.post.canceled).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Self-agreement math (Plan-Lens 1 BLOCKING #2)
// ─────────────────────────────────────────────────────────────────────

describe('computeSelfAgreement', () => {
  test('CALIBRATION_DEFAULT_N is 5 (not 3) per Plan-Lens 1 BLOCKING #2', () => {
    expect(CALIBRATION_DEFAULT_N).toBe(5);
  });

  test('N=0 returns zero metrics', () => {
    const sa = computeSelfAgreement([]);
    expect(sa.n).toBe(0);
    expect(sa.perBullet).toBe(0);
    expect(sa.perScenario).toBe(0);
  });

  test('N=5 unanimous → perBullet=1, perScenario=1, all bullets pass agreement', () => {
    const runs = Array.from({ length: 5 }, () => passJudge);
    const sa = computeSelfAgreement(runs);
    expect(sa.n).toBe(5);
    expect(sa.perBullet).toBe(1);
    expect(sa.perScenario).toBe(1);
    expect(sa.bulletBreakdown.every((b) => b.passes)).toBe(true);
  });

  test('N=5 one bullet wobbles 4/5 → bullet agreement 0.8, passes threshold', () => {
    const wobble: JudgeResult = {
      ...passJudge,
      verdicts: [
        { tier: 'must', bullet: 'return greeting', pass: false, rationale: 'unclear' },
        passJudge.verdicts[1],
        passJudge.verdicts[2],
      ],
      mustPass: 0,
      mustFail: 1,
      passed: false,
    };
    // 4 pass-runs + 1 fail-run → bullet 0 majority=4/5=0.8, passes (>=0.8).
    const runs = [passJudge, passJudge, passJudge, passJudge, wobble];
    const sa = computeSelfAgreement(runs);
    expect(sa.bulletBreakdown[0].majorityCount).toBe(4);
    expect(sa.bulletBreakdown[0].agreement).toBeCloseTo(0.8);
    expect(sa.bulletBreakdown[0].passes).toBe(true);
    expect(sa.perBullet).toBe(1); // all 3 bullets pass (one at 0.8, two at 1.0)
    expect(sa.perScenario).toBe(0.8); // 4/5 runs match the mode (passed=true)
  });

  test('N=5 bullet 3/5 → agreement 0.6, FAILS threshold', () => {
    const wobble: JudgeResult = {
      ...passJudge,
      verdicts: [
        { tier: 'must', bullet: 'return greeting', pass: false, rationale: 'x' },
        ...passJudge.verdicts.slice(1),
      ],
      mustPass: 0,
      mustFail: 1,
      passed: false,
    };
    // 3 pass + 2 fail → majority=3/5=0.6 → fails 0.8 threshold.
    const runs = [passJudge, passJudge, passJudge, wobble, wobble];
    const sa = computeSelfAgreement(runs);
    expect(sa.bulletBreakdown[0].agreement).toBeCloseTo(0.6);
    expect(sa.bulletBreakdown[0].passes).toBe(false);
    // perBullet = 2/3 (1 fails, 2 pass) ≈ 0.667
    expect(sa.perBullet).toBeCloseTo(2 / 3);
  });

  test('BULLET_AGREEMENT_THRESHOLD is 0.8, GATE thresholds are 0.9', () => {
    expect(BULLET_AGREEMENT_THRESHOLD).toBe(0.8);
    expect(GATE_PER_BULLET_THRESHOLD).toBe(0.9);
    expect(GATE_PER_SCENARIO_THRESHOLD).toBe(0.9);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Calibration entry + merge (Plan-Lens 1 IMPORTANT #5)
// ─────────────────────────────────────────────────────────────────────

describe('buildCalibrationEntry', () => {
  const passVerdict = {
    scenarioId: 'B01',
    overall: 'pass' as const,
    deterministic: { checks: [], anyUnverifiable: false, anyFailed: false },
    opAFailures: { pre: { failed: 0, canceled: 0 }, post: { failed: 0, canceled: 0 } },
  };
  const sa = { n: 5, perBullet: 1.0, perScenario: 1.0, bulletBreakdown: [] };

  test('clean run + unanimous → passesGate=true', () => {
    const e = buildCalibrationEntry({
      selfAgreement: sa,
      latestVerdict: passVerdict,
      judgeModel: 'grok-4.20-non-reasoning',
      rubricHash: 'abc',
    });
    expect(e.passesGate).toBe(true);
    expect(e.blockedReason).toBeUndefined();
  });

  test('perBullet below gate → passesGate=false with reason', () => {
    const e = buildCalibrationEntry({
      selfAgreement: { ...sa, perBullet: 0.85 },
      latestVerdict: passVerdict,
      judgeModel: 'x',
      rubricHash: 'abc',
    });
    expect(e.passesGate).toBe(false);
    expect(e.blockedReason).toContain('perBullet');
  });

  test('unverifiable det checks → passesGate=false (B06 will land here)', () => {
    const e = buildCalibrationEntry({
      selfAgreement: sa,
      latestVerdict: {
        ...passVerdict,
        overall: 'skipped',
        deterministic: {
          checks: [
            {
              name: 'expectedAction',
              status: 'unverifiable',
              expected: 'walk-away',
              reason: 'no-action-log',
            },
          ],
          anyUnverifiable: true,
          anyFailed: false,
        },
      },
      judgeModel: 'x',
      rubricHash: 'abc',
    });
    expect(e.passesGate).toBe(false);
    expect(e.blockedReason).toContain('expectedAction');
    expect(e.blockedReason).toContain('no-action-log');
  });

  test('opA post failures → passesGate=false with reason', () => {
    const e = buildCalibrationEntry({
      selfAgreement: sa,
      latestVerdict: {
        ...passVerdict,
        opAFailures: { pre: { failed: 0, canceled: 0 }, post: { failed: 1, canceled: 0 } },
      },
      judgeModel: 'x',
      rubricHash: 'abc',
    });
    expect(e.passesGate).toBe(false);
    expect(e.blockedReason).toContain('opA');
  });

  test('lastCalibratedAt is ISO string with `now` override', () => {
    const e = buildCalibrationEntry({
      selfAgreement: sa,
      latestVerdict: passVerdict,
      judgeModel: 'x',
      rubricHash: 'abc',
      now: new Date('2026-05-22T00:00:00Z'),
    });
    expect(e.lastCalibratedAt).toBe('2026-05-22T00:00:00.000Z');
  });
});

describe('mergeCalibrationEntry — diff-then-write', () => {
  const baseEntry = {
    lastCalibratedAt: '2026-05-22T00:00:00.000Z',
    n: 5,
    perBulletAgreement: 1.0,
    perScenarioAgreement: 1.0,
    passesGate: true,
    judgeModel: 'grok',
    rubricHash: 'abc',
  };
  const state: CalibrationState = { version: 1, scenarios: { B01: baseEntry } };

  test('adding new scenario → changed=true', () => {
    const r = mergeCalibrationEntry(state, 'B02', baseEntry);
    expect(r.changed).toBe(true);
    expect(r.state.scenarios.B02).toBeDefined();
  });

  test('same entry except newer timestamp → changed=false (Plan-Lens 1 IMPORTANT #5)', () => {
    const fresh = { ...baseEntry, lastCalibratedAt: '2026-05-23T00:00:00.000Z' };
    const r = mergeCalibrationEntry(state, 'B01', fresh);
    expect(r.changed).toBe(false);
    expect(r.state).toBe(state);
  });

  test('rubricHash change → changed=true', () => {
    const fresh = { ...baseEntry, rubricHash: 'def' };
    const r = mergeCalibrationEntry(state, 'B01', fresh);
    expect(r.changed).toBe(true);
  });

  test('passesGate flip → changed=true', () => {
    const fresh = { ...baseEntry, passesGate: false, blockedReason: 'judge-noise' };
    const r = mergeCalibrationEntry(state, 'B01', fresh);
    expect(r.changed).toBe(true);
  });

  test('perBullet drift >0.01 → changed=true; ≤0.01 → changed=false', () => {
    const small = { ...baseEntry, perBulletAgreement: 1.005 };
    expect(mergeCalibrationEntry(state, 'B01', small).changed).toBe(false);
    const big = { ...baseEntry, perBulletAgreement: 0.92 };
    expect(mergeCalibrationEntry(state, 'B01', big).changed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Rubric hash + drift invalidation (Plan-Lens 1 BLOCKING #3)
// ─────────────────────────────────────────────────────────────────────

describe('canonicalizeRubricForHashing + hashRubric', () => {
  test('whitespace inside bullets is normalized', () => {
    const a = canonicalizeRubricForHashing({ must: ['hello  world'] });
    const b = canonicalizeRubricForHashing({ must: ['hello world'] });
    expect(a).toBe(b);
  });

  test('reordering bullets DOES change canonical form (judges read order)', () => {
    const a = canonicalizeRubricForHashing({ must: ['x'], should: ['y'] });
    const b = canonicalizeRubricForHashing({ must: ['y'], should: ['x'] });
    expect(a).not.toBe(b);
  });

  test('absent should/mustNot omitted from canonical form', () => {
    const a = canonicalizeRubricForHashing({ must: ['x'] });
    const b = canonicalizeRubricForHashing({ must: ['x'], should: [], mustNot: [] });
    expect(a).not.toBe(b);
  });

  test('hashRubric produces 64-char hex SHA-256', async () => {
    const h = await hashRubric({ must: ['hello'] });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  test('same rubric → same hash; different rubric → different hash', async () => {
    const h1 = await hashRubric({ must: ['hello'] });
    const h2 = await hashRubric({ must: ['hello'] });
    const h3 = await hashRubric({ must: ['goodbye'] });
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});

describe('invalidateOnRubricDrift', () => {
  const entry = {
    lastCalibratedAt: '2026-05-22T00:00:00.000Z',
    n: 5,
    perBulletAgreement: 1.0,
    perScenarioAgreement: 1.0,
    passesGate: true,
    judgeModel: 'grok',
    rubricHash: 'abc123',
  };

  test('matching hash → returned unchanged', () => {
    expect(invalidateOnRubricDrift(entry, 'abc123')).toBe(entry);
  });

  test('mismatched hash → passesGate=false with rubric-drift reason', () => {
    const r = invalidateOnRubricDrift(entry, 'def456');
    expect(r.passesGate).toBe(false);
    expect(r.blockedReason).toContain('rubric-changed-since-calibration');
    expect(r.blockedReason).toContain('abc123'.slice(0, 8));
    expect(r.blockedReason).toContain('def456'.slice(0, 8));
  });
});
