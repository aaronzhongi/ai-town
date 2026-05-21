// N1 golden vectors — hand-computed from
//   Current = Baseline + (Value − Baseline)·exp(−(now − LastSetMs)/HalfLifeMs)
// with exp(-1) = 0.36787944117144233, exp(-10) = 4.5399929762484854e-5.
// Faithfulness guard for jynew RuntimeMindState.cs:51-56 (plan N1).

import { Affect, affectCurrent } from './affect';

const mk = (p: Partial<Affect>): Affect => ({
  label: '',
  value: 0,
  baseline: 0,
  lastSetMs: 0,
  halfLifeMs: 90_000,
  ...p,
});

describe('affectCurrent (N1 decay)', () => {
  test('guard: halfLifeMs == 0 returns raw value (no decay)', () => {
    expect(affectCurrent(mk({ value: 0.7, halfLifeMs: 0, lastSetMs: 1000 }), 999_999)).toBe(0.7);
  });

  test('guard: halfLifeMs < 0 returns raw value', () => {
    expect(affectCurrent(mk({ value: -0.42, halfLifeMs: -3 }), 1_000_000)).toBe(-0.42);
  });

  test('dt == 0 (now == lastSetMs) returns value exactly', () => {
    expect(affectCurrent(mk({ value: 1, baseline: 0, lastSetMs: 5000 }), 5000)).toBe(1);
    expect(affectCurrent(mk({ value: 0.31, baseline: 0.9, lastSetMs: 5000 }), 5000)).toBeCloseTo(
      0.31,
      12,
    );
  });

  test('one half-life: emotion (baseline 0) decays to value·exp(-1)', () => {
    expect(
      affectCurrent(mk({ value: 1, baseline: 0, halfLifeMs: 90_000 }), 90_000),
    ).toBeCloseTo(0.36787944117144233, 12);
  });

  test('one half-life: affection (stranger baseline 0, S3)', () => {
    expect(
      affectCurrent(mk({ value: 0.5, baseline: 0, halfLifeMs: 900_000 }), 900_000),
    ).toBeCloseTo(0.18393972058572117, 12);
  });

  test('one half-life: decay toward a non-zero baseline (multi-NPC future, values intact)', () => {
    expect(
      affectCurrent(mk({ value: 1.0, baseline: 0.4, halfLifeMs: 1000 }), 1000),
    ).toBeCloseTo(0.6207276647028654, 12);
  });

  test('negative affection decays toward 0 baseline', () => {
    expect(
      affectCurrent(mk({ value: -0.8, baseline: 0, halfLifeMs: 900_000 }), 900_000),
    ).toBeCloseTo(-0.29430355293715386, 12);
  });

  test('ten half-lives ≈ baseline (deep decay)', () => {
    expect(
      affectCurrent(mk({ value: 1, baseline: 0, halfLifeMs: 90_000 }), 900_000),
    ).toBeCloseTo(4.5399929762484854e-5, 12);
  });
});
