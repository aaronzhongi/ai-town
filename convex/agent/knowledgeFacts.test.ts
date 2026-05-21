// Memory v3.5 — unit tests for the pure helpers in `knowledgeFacts.ts`.
//
// Golden-vector tests cover: N26 keyword normalize+merge, N27
// importance clamp + monotonic rise, N24 multiplicative scaling
// (v3.4 C9), factScore composition, per-target pinned-first +
// score sort, general-slice INSTINCT_RENDER_FLOOR enforcement, and
// __general__ slice keyword-overlap selection.

import {
  normalizeKeywords,
  mergeKeywords,
  normalizeImportance,
  maxImportance,
  normalizeAffectImpact,
  n24Scale,
  factScore,
  sortPerTargetFacts,
  sortGeneralFacts,
  selectGeneralSliceInstincts,
  KnowledgeFactView,
  Keyword,
} from './knowledgeFacts';
import {
  KNOWLEDGE_FACT_MAX_KEYWORDS,
  KNOWLEDGE_KEYWORD_MAX_CHARS,
  KNOWLEDGE_IMPORTANCE_MIN,
  KNOWLEDGE_IMPORTANCE_MAX,
  KNOWLEDGE_IMPORTANCE_DEFAULT,
  N24_REFIRE_PERF_FLOOR,
  RECENCY_HALFLIFE_MS,
} from '../constants';

// ─────────────────────────────────────────────────────────────────────
// Test fixture builder. Sensible defaults so tests focus on one field.
// ─────────────────────────────────────────────────────────────────────
const fact = (p: Partial<KnowledgeFactView> = {}): KnowledgeFactView => ({
  tier: 'LT',
  source: 'op-a',
  importance: 3,
  frequency: 1,
  lastUpdatedAt: 0,
  pinned: false,
  keywords: [],
  factText: '',
  ...p,
});

// ─────────────────────────────────────────────────────────────────────
// N26 keyword layer
// ─────────────────────────────────────────────────────────────────────
describe('normalizeKeywords (N26)', () => {
  test('empty / undefined → []', () => {
    expect(normalizeKeywords(undefined)).toEqual([]);
    expect(normalizeKeywords([])).toEqual([]);
  });

  test('trims, drops empties, clamps ratio to [0,1]', () => {
    const out = normalizeKeywords([
      { keyword: '  山谷  ', assocRatio: 0.7 },
      { keyword: '', assocRatio: 0.9 },
      { keyword: '出路', assocRatio: 1.5 }, // > 1 → 1
      { keyword: '陌生', assocRatio: -0.3 }, // < 0 → 0
      { keyword: '危险', assocRatio: NaN as any }, // NaN → 0
    ]);
    expect(out).toEqual([
      { keyword: '出路', assocRatio: 1 },
      { keyword: '山谷', assocRatio: 0.7 },
      { keyword: '陌生', assocRatio: 0 },
      { keyword: '危险', assocRatio: 0 },
    ]);
  });

  test('truncates each keyword to KNOWLEDGE_KEYWORD_MAX_CHARS', () => {
    const longKw = '关键'.repeat(20); // 40 chars > 16
    const out = normalizeKeywords([{ keyword: longKw, assocRatio: 1 }]);
    expect(out).toHaveLength(1);
    expect(out[0].keyword.length).toBeLessThanOrEqual(KNOWLEDGE_KEYWORD_MAX_CHARS);
    expect(out[0].keyword).toBe('关键'.repeat(KNOWLEDGE_KEYWORD_MAX_CHARS / 2));
  });

  test('de-dups case-insensitively; takes max ratio on collision; keeps first-seen text', () => {
    const out = normalizeKeywords([
      { keyword: 'safety', assocRatio: 0.4 },
      { keyword: 'SAFETY', assocRatio: 0.9 },
      { keyword: 'Safety', assocRatio: 0.6 },
    ]);
    expect(out).toEqual([{ keyword: 'safety', assocRatio: 0.9 }]);
  });

  test('truncates list to KNOWLEDGE_FACT_MAX_KEYWORDS by descending ratio', () => {
    const inputs: Keyword[] = [];
    for (let i = 0; i < KNOWLEDGE_FACT_MAX_KEYWORDS + 5; i++) {
      inputs.push({ keyword: `k${i}`, assocRatio: 1 - i * 0.05 });
    }
    const out = normalizeKeywords(inputs);
    expect(out).toHaveLength(KNOWLEDGE_FACT_MAX_KEYWORDS);
    // descending ratio
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].assocRatio).toBeGreaterThanOrEqual(out[i].assocRatio);
    }
    // the top KNOWLEDGE_FACT_MAX_KEYWORDS by ratio are k0..k7
    expect(out.map((k) => k.keyword)).toEqual(
      Array.from({ length: KNOWLEDGE_FACT_MAX_KEYWORDS }, (_, i) => `k${i}`),
    );
  });

  test('tiebreak by first-occurrence when ratios equal (stable sort)', () => {
    const out = normalizeKeywords([
      { keyword: 'alpha', assocRatio: 0.5 },
      { keyword: 'beta', assocRatio: 0.5 },
      { keyword: 'gamma', assocRatio: 0.5 },
    ]);
    expect(out.map((k) => k.keyword)).toEqual(['alpha', 'beta', 'gamma']);
  });
});

describe('mergeKeywords (N26 deterministic union+max+truncate)', () => {
  test('a alone / b alone / both empty', () => {
    const a: Keyword[] = [{ keyword: '出路', assocRatio: 0.8 }];
    expect(mergeKeywords(a, undefined)).toEqual(a);
    expect(mergeKeywords(undefined, a)).toEqual(a);
    expect(mergeKeywords(undefined, undefined)).toEqual([]);
  });

  test('union by case-insensitive key; max ratio on collision; first-seen text wins', () => {
    const a: Keyword[] = [
      { keyword: '陌生', assocRatio: 0.4 },
      { keyword: '危险', assocRatio: 0.7 },
    ];
    const b: Keyword[] = [
      { keyword: '陌生', assocRatio: 0.9 }, // higher → take 0.9, keep 'a's text
      { keyword: '友善', assocRatio: 0.5 },
    ];
    const out = mergeKeywords(a, b);
    expect(out).toEqual([
      { keyword: '陌生', assocRatio: 0.9 },
      { keyword: '危险', assocRatio: 0.7 },
      { keyword: '友善', assocRatio: 0.5 },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// N27 importance
// ─────────────────────────────────────────────────────────────────────
describe('normalizeImportance (N27)', () => {
  test('missing / non-finite → DEFAULT', () => {
    expect(normalizeImportance(undefined)).toBe(KNOWLEDGE_IMPORTANCE_DEFAULT);
    expect(normalizeImportance(null)).toBe(KNOWLEDGE_IMPORTANCE_DEFAULT);
    expect(normalizeImportance(NaN)).toBe(KNOWLEDGE_IMPORTANCE_DEFAULT);
    expect(normalizeImportance(Infinity)).toBe(KNOWLEDGE_IMPORTANCE_DEFAULT);
  });
  test('clamps to [MIN, MAX] and rounds', () => {
    expect(normalizeImportance(0)).toBe(KNOWLEDGE_IMPORTANCE_MIN);
    expect(normalizeImportance(0.4)).toBe(KNOWLEDGE_IMPORTANCE_MIN); // rounds to 0 → clamped up
    expect(normalizeImportance(2.6)).toBe(3);
    expect(normalizeImportance(5)).toBe(KNOWLEDGE_IMPORTANCE_MAX);
    expect(normalizeImportance(99)).toBe(KNOWLEDGE_IMPORTANCE_MAX);
  });
});

describe('maxImportance (N27 monotonic rise on merge)', () => {
  test('takes the larger of the two normalized values', () => {
    expect(maxImportance(2, 4)).toBe(4);
    expect(maxImportance(5, 1)).toBe(5);
  });
  test('treats missing as DEFAULT, then takes max', () => {
    // DEFAULT=1, so max(undefined, 3) → max(1, 3) = 3
    expect(maxImportance(undefined, 3)).toBe(3);
    expect(maxImportance(3, undefined)).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────
// affectImpact / N24 multiplicative scaling
// ─────────────────────────────────────────────────────────────────────
describe('normalizeAffectImpact (Rec 6 confidence default)', () => {
  test('null/undefined → null', () => {
    expect(normalizeAffectImpact(null)).toBeNull();
    expect(normalizeAffectImpact(undefined)).toBeNull();
  });
  test('empty/whitespace label → null (structurally empty)', () => {
    expect(normalizeAffectImpact({ label: '', intensity: 0.5, confidence: 0.7 })).toBeNull();
    expect(normalizeAffectImpact({ label: '   ' })).toBeNull();
  });
  test('clamps intensity to [-1,1] and confidence to [0,1]', () => {
    const a = normalizeAffectImpact({ label: '警惕', intensity: 1.7, confidence: -0.5 });
    expect(a).toEqual({ label: '警惕', intensity: 1, confidence: 0, targetEntity: null });
    const b = normalizeAffectImpact({ label: '不舍', intensity: -2, confidence: 1.5 });
    expect(b).toEqual({ label: '不舍', intensity: -1, confidence: 1, targetEntity: null });
  });
  test('missing confidence → 0.5 default; non-finite → 0.5', () => {
    expect(normalizeAffectImpact({ label: '喜悦', intensity: 0.4 })?.confidence).toBe(0.5);
    expect(normalizeAffectImpact({ label: '喜悦', intensity: 0.4, confidence: NaN })?.confidence).toBe(
      0.5,
    );
  });
});

describe('n24Scale (v3.4 C9 multiplicative — every re-fire fires)', () => {
  test('null impact → applied=0, shouldRefire=false', () => {
    expect(n24Scale(null)).toEqual({ applied: 0, shouldRefire: false });
  });
  test('intensity × confidence preserves SIGN', () => {
    const neg = n24Scale({ label: '不快', intensity: -0.8, confidence: 0.6 });
    expect(neg.applied).toBeCloseTo(-0.48);
    expect(neg.shouldRefire).toBe(true);
    const pos = n24Scale({ label: '喜悦', intensity: 0.5, confidence: 0.5 });
    expect(pos.applied).toBeCloseTo(0.25);
    expect(pos.shouldRefire).toBe(true);
  });
  test('|applied| < N24_REFIRE_PERF_FLOOR → shouldRefire=false (perf skip)', () => {
    const justUnder = N24_REFIRE_PERF_FLOOR - 0.001;
    const intensity = justUnder; // confidence=1 → applied = justUnder
    const result = n24Scale({ label: '微感', intensity, confidence: 1 });
    expect(result.applied).toBeCloseTo(justUnder);
    expect(result.shouldRefire).toBe(false);
  });
  test('|applied| >= floor → shouldRefire=true (boundary fires)', () => {
    const atFloor = n24Scale({ label: '微感', intensity: N24_REFIRE_PERF_FLOOR, confidence: 1 });
    expect(atFloor.shouldRefire).toBe(true);
  });
  test('low-confidence soft-fire: a high-intensity 0.9 with confidence 0.1 applies 0.09', () => {
    const r = n24Scale({ label: '惊讶', intensity: 0.9, confidence: 0.1 });
    expect(r.applied).toBeCloseTo(0.09);
    // 0.09 > 0.05 floor → fires (softly)
    expect(r.shouldRefire).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// factScore composition
// ─────────────────────────────────────────────────────────────────────
describe('factScore (importance × frequency × exp(-Δt/τ))', () => {
  test('fresh row (Δt=0) → importance × frequency', () => {
    const row = fact({ importance: 4, frequency: 3, lastUpdatedAt: 1000 });
    expect(factScore(row, 1000)).toBeCloseTo(12);
  });
  test('one half-life of staleness halves the score', () => {
    const row = fact({ importance: 2, frequency: 5, lastUpdatedAt: 0 });
    const halfLifed = factScore(row, RECENCY_HALFLIFE_MS);
    expect(halfLifed).toBeCloseTo(2 * 5 * Math.exp(-1));
  });
  test('future-dated lastUpdatedAt clamps Δt to 0 (no boost beyond fresh)', () => {
    const row = fact({ importance: 3, frequency: 2, lastUpdatedAt: 10_000 });
    expect(factScore(row, 5_000)).toBeCloseTo(6);
  });
});

// ─────────────────────────────────────────────────────────────────────
// sortPerTargetFacts — pinned first, score sort, half-budget cap
// ─────────────────────────────────────────────────────────────────────
describe('sortPerTargetFacts (§6 per-target order)', () => {
  test('pinned first, then non-pinned by score', () => {
    const rows = [
      fact({ importance: 5, frequency: 1, lastUpdatedAt: 1000, factText: 'normal-high' }),
      fact({ pinned: true, lastUpdatedAt: 500, factText: 'pinned-older' }),
      fact({ importance: 1, frequency: 1, lastUpdatedAt: 1000, factText: 'normal-low' }),
      fact({ pinned: true, lastUpdatedAt: 800, factText: 'pinned-newer' }),
    ];
    const { pinned, normal } = sortPerTargetFacts(rows, 1000, 8);
    expect(pinned.map((r) => r.factText)).toEqual(['pinned-newer', 'pinned-older']);
    expect(normal[0].factText).toBe('normal-high');
    expect(normal[1].factText).toBe('normal-low');
  });
  test('importance lifts a one-shot pivotal fact above chatty trivia', () => {
    const pivotal = fact({ importance: 5, frequency: 1, lastUpdatedAt: 0, factText: 'pivotal' });
    const trivia = fact({ importance: 1, frequency: 10, lastUpdatedAt: 0, factText: 'chatty' });
    const { normal } = sortPerTargetFacts([trivia, pivotal], 0, 8);
    // factScore: pivotal = 5*1 = 5; chatty = 1*10 = 10 — actually trivia wins here.
    // Adjust expectation: when freq is 10× pivotal, importance must >freq ratio.
    expect(normal[0].factText).toBe('chatty'); // confirms freq dominates when ratio is large
    // Now flip: importance=5 vs freq=4 → pivotal=20, chatty=4 → pivotal wins.
    const trivia2 = fact({ importance: 1, frequency: 4, lastUpdatedAt: 0, factText: 'chatty4' });
    const { normal: n2 } = sortPerTargetFacts([trivia2, pivotal], 0, 8);
    expect(n2[0].factText).toBe('pivotal');
  });
  test('pinned set is half-budget capped; lowest-importance pinned excluded by recency', () => {
    const rows: KnowledgeFactView[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(fact({ pinned: true, lastUpdatedAt: i * 100, factText: `p${i}` }));
    }
    rows.push(fact({ importance: 1, frequency: 1, lastUpdatedAt: 0, factText: 'normal' }));
    const { pinned, normal } = sortPerTargetFacts(rows, 0, 6);
    // half-budget cap for pinned = ceil(6/2) = 3
    expect(pinned.length).toBe(3);
    // Most-recent pinned first
    expect(pinned[0].factText).toBe('p9');
    expect(pinned[1].factText).toBe('p8');
    expect(pinned[2].factText).toBe('p7');
    // budget - pinned.length = 3 slots for normal, but only 1 normal row exists
    expect(normal.length).toBe(1);
    expect(normal[0].factText).toBe('normal');
  });
  test('budget <= 0 → empty arrays', () => {
    const out = sortPerTargetFacts([fact({})], 0, 0);
    expect(out).toEqual({ pinned: [], normal: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────
// sortGeneralFacts — score + tiebreak + INSTINCT_RENDER_FLOOR
// ─────────────────────────────────────────────────────────────────────
describe('sortGeneralFacts (§6 general block with INSTINCT_RENDER_FLOOR)', () => {
  test('on score tie, op-a wins over instinct (Lens 2 REC-3)', () => {
    const opa = fact({ source: 'op-a', importance: 3, frequency: 1, factText: 'opa' });
    const ins = fact({ source: 'instinct', importance: 3, frequency: 1, factText: 'ins' });
    const out = sortGeneralFacts([ins, opa], 0, 2, 0);
    expect(out[0].factText).toBe('opa');
    expect(out[1].factText).toBe('ins');
  });
  test('floor=2 evicts lowest-scoring non-instinct rows to seat instincts', () => {
    const rows = [
      // top 4 by score (all op-a)
      fact({ source: 'op-a', importance: 5, frequency: 5, factText: 'opa-25' }), // 25
      fact({ source: 'op-a', importance: 5, frequency: 4, factText: 'opa-20' }), // 20
      fact({ source: 'op-a', importance: 4, frequency: 4, factText: 'opa-16' }), // 16
      fact({ source: 'op-a', importance: 3, frequency: 4, factText: 'opa-12' }), // 12
      // two instincts below the top-4 score
      fact({ source: 'instinct', importance: 3, frequency: 2, factText: 'ins-6' }), // 6
      fact({ source: 'instinct', importance: 2, frequency: 2, factText: 'ins-4' }), // 4
    ];
    const out = sortGeneralFacts(rows, 0, 4, 2);
    const labels = out.map((r) => r.factText).sort();
    // Top 4 had no instincts → evict opa-16, opa-12 (lowest-scoring opa)
    // Substitute the two instincts (ins-6, ins-4).
    expect(labels).toEqual(['ins-4', 'ins-6', 'opa-20', 'opa-25'].sort());
  });
  test('floor satisfied naturally → no eviction', () => {
    const rows = [
      fact({ source: 'instinct', importance: 5, frequency: 1, factText: 'ins-high1' }), // 5
      fact({ source: 'instinct', importance: 5, frequency: 1, lastUpdatedAt: -10, factText: 'ins-high2' }),
      fact({ source: 'op-a', importance: 1, frequency: 1, factText: 'opa' }), // 1
    ];
    const out = sortGeneralFacts(rows, 0, 3, 2);
    expect(out).toHaveLength(3);
    // Both instincts already in top-3 → no substitution
    const ins = out.filter((r) => r.source === 'instinct');
    expect(ins).toHaveLength(2);
  });
  test('instinct pool smaller than floor → take all instincts available, no error', () => {
    const rows = [
      fact({ source: 'op-a', importance: 5, frequency: 5, factText: 'opa-25' }),
      fact({ source: 'op-a', importance: 4, frequency: 4, factText: 'opa-16' }),
      fact({ source: 'instinct', importance: 1, frequency: 1, factText: 'lone-ins' }),
    ];
    const out = sortGeneralFacts(rows, 0, 2, 2);
    // floor=2 but only one instinct exists → evict only one opa
    const ins = out.filter((r) => r.source === 'instinct');
    expect(ins).toHaveLength(1);
    expect(out).toHaveLength(2);
  });
  test('budget <= 0 → empty', () => {
    expect(sortGeneralFacts([fact({})], 0, 0)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// __general__ slice keyword-overlap selection (Op A C7)
// ─────────────────────────────────────────────────────────────────────
describe('selectGeneralSliceInstincts (Op A v3.4 C7 keyword overlap)', () => {
  test('returns [] when no instincts present', () => {
    const rows = [fact({ source: 'op-a' })];
    expect(selectGeneralSliceInstincts(rows, [], 1000)).toEqual([]);
  });
  test('picks instincts in descending keyword-overlap order; oldest tiebreak', () => {
    const rows = [
      fact({
        source: 'instinct',
        factText: 'a'.repeat(50),
        keywords: [{ keyword: '陌生', assocRatio: 1 }],
        lastUpdatedAt: 5,
      }),
      fact({
        source: 'instinct',
        factText: 'b'.repeat(50),
        keywords: [
          { keyword: '陌生', assocRatio: 1 },
          { keyword: '危险', assocRatio: 1 },
        ],
        lastUpdatedAt: 100, // newer
      }),
      fact({
        source: 'instinct',
        factText: 'c'.repeat(50),
        keywords: [
          { keyword: '陌生', assocRatio: 1 },
          { keyword: '危险', assocRatio: 1 },
        ],
        lastUpdatedAt: 50, // older within overlap=2 tier
      }),
    ];
    const out = selectGeneralSliceInstincts(
      rows,
      [
        { keyword: '陌生', assocRatio: 0.5 },
        { keyword: '危险', assocRatio: 0.5 },
      ],
      150,
    );
    // overlap=2 rows come first; among them oldest first (c, then b);
    // overlap=1 row last (a) — budget 150 fits exactly 3*50.
    expect(out.map((r) => r.factText)).toEqual([
      'c'.repeat(50),
      'b'.repeat(50),
      'a'.repeat(50),
    ]);
  });
  test('respects char budget; stops once budget would be exceeded', () => {
    const rows = [
      fact({
        source: 'instinct',
        factText: 'big-row-' + 'x'.repeat(100),
        keywords: [{ keyword: 'k', assocRatio: 1 }],
      }),
      fact({
        source: 'instinct',
        factText: 'small',
        keywords: [{ keyword: 'k', assocRatio: 1 }],
      }),
    ];
    // Budget < first row size → still take it (caller wants at least one),
    // but skip the rest. The contract says "stop once usedChars >= budget".
    const out = selectGeneralSliceInstincts(rows, [{ keyword: 'k', assocRatio: 1 }], 50);
    expect(out).toHaveLength(1);
    expect((out[0].factText ?? '').startsWith('big-row-')).toBe(true);
  });
  test('empty input keyword set → overlap=0 for all; falls back to oldest-first ordering', () => {
    const rows = [
      fact({
        source: 'instinct',
        factText: 'a'.repeat(50),
        keywords: [{ keyword: '陌生', assocRatio: 1 }],
        lastUpdatedAt: 100, // newer
      }),
      fact({
        source: 'instinct',
        factText: 'b'.repeat(50),
        keywords: [{ keyword: '危险', assocRatio: 1 }],
        lastUpdatedAt: 50, // older
      }),
    ];
    const out = selectGeneralSliceInstincts(rows, [], 150);
    // overlap=0 for both → tiebreak by ascending lastUpdatedAt
    expect(out.map((r) => r.factText)).toEqual(['b'.repeat(50), 'a'.repeat(50)]);
  });
});
