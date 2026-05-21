// Memory v3.5 Op A — pure-helper unit tests.
//
// Covers the deterministic outer-layer of Op A end-to-end:
//   safeParseOpAResponse  — Grok-JSON tolerance (fences / prose-around)
//   normalizeFact         — per-fact normalization
//   computeFactWriteOp    — 4-decision match-tree apply (insert /
//                            exact / partial / lt-only)
//   resolveEntity         — display-name → playerId resolution
//   findExactDupInST      — pre-LLM exact-dup short-circuit (option b)

import {
  safeParseOpAResponse,
  normalizeFact,
  computeFactWriteOp,
  resolveEntity,
  findExactDupInST,
} from './opAParse';
import { KnowledgeFactView } from './knowledgeFacts';

// Fixture helper. `history` is supplied because the Convex row shape
// has it as a required array; pure tests need to match the runtime
// shape.
const existingRow = (
  p: Partial<KnowledgeFactView & { _id: string; history: unknown[] }> = {},
): KnowledgeFactView & { _id: string } => ({
  _id: 'kf:existing',
  tier: 'LT',
  source: 'op-a',
  importance: 3,
  frequency: 2,
  lastUpdatedAt: 1000,
  pinned: false,
  keywords: [{ keyword: '陌生', assocRatio: 0.5 }],
  factText: '他自称叫李平。',
  affectImpact: undefined,
  history: [],
  ...p,
}) as any;

describe('safeParseOpAResponse', () => {
  test('plain JSON object → parsed', () => {
    const out = safeParseOpAResponse('{"facts": [], "affect": null}');
    expect(out.facts).toEqual([]);
  });

  test('JSON wrapped in ```json …``` fence → fence stripped', () => {
    const out = safeParseOpAResponse('```json\n{"facts": [{"factText": "x"}]}\n```');
    expect(out.facts?.[0]?.factText).toBe('x');
  });

  test('JSON wrapped in ``` …``` (no language tag) → fence stripped', () => {
    const out = safeParseOpAResponse('```\n{"facts": []}\n```');
    expect(out.facts).toEqual([]);
  });

  test('prose around JSON object → object extracted by brace-counting', () => {
    const out = safeParseOpAResponse(
      'Here is the result:\n{"facts": [{"factText": "y"}]}\nThanks!',
    );
    expect(out.facts?.[0]?.factText).toBe('y');
  });

  test('nested objects → brace counting handles them', () => {
    const out = safeParseOpAResponse(
      '{"facts": [{"factText": "z", "affectImpact": {"label": "fear", "intensity": 0.5}}]}',
    );
    expect(out.facts?.[0]?.affectImpact?.label).toBe('fear');
  });

  test('missing facts array → defaults to []', () => {
    const out = safeParseOpAResponse('{"affect": {}}');
    expect(out.facts).toEqual([]);
  });

  test('empty string → throws', () => {
    expect(() => safeParseOpAResponse('')).toThrow(/empty/);
    expect(() => safeParseOpAResponse('   ')).toThrow(/empty/);
  });

  test('no JSON object at all → throws', () => {
    expect(() => safeParseOpAResponse('hello world')).toThrow(/no JSON object/);
  });

  test('unclosed brace → throws', () => {
    expect(() => safeParseOpAResponse('{"facts": [')).toThrow(/unclosed/);
  });

  test('malformed JSON inside braces → throws', () => {
    expect(() => safeParseOpAResponse('{not really json}')).toThrow(/JSON\.parse/);
  });
});

describe('normalizeFact', () => {
  test('passes raw factText through trim + char cap', () => {
    const out = normalizeFact({ factText: '  hello  ' });
    expect(out.factText).toBe('hello');
  });

  test('passes keywords through N26 normalize', () => {
    const out = normalizeFact({
      keywords: [
        { keyword: '陌生', assocRatio: 0.4 },
        { keyword: '陌生', assocRatio: 0.9 }, // dedup: take max
      ],
    });
    expect(out.keywords).toEqual([{ keyword: '陌生', assocRatio: 0.9 }]);
  });

  test('clamps importance through N27 (out-of-range → bounds)', () => {
    expect(normalizeFact({ importance: 99 }).importance).toBe(5);
    expect(normalizeFact({ importance: 0 }).importance).toBe(1);
    expect(normalizeFact({ importance: undefined }).importance).toBe(1);
  });

  test('default decision is "insert" when missing or malformed', () => {
    expect(normalizeFact({}).decision).toBe('insert');
    expect(normalizeFact({ decision: 'bogus' as any }).decision).toBe('insert');
  });

  test('preserves each valid decision verbatim', () => {
    for (const d of ['insert', 'exact', 'partial', 'lt-only'] as const) {
      expect(normalizeFact({ decision: d }).decision).toBe(d);
    }
  });

  test('normalizes affectImpact through helper (label-empty → null)', () => {
    expect(normalizeFact({ affectImpact: { label: '', intensity: 0.5 } }).affectImpact).toBeNull();
    const aff = normalizeFact({
      affectImpact: { label: '警惕', intensity: 0.5, confidence: 0.7 },
    }).affectImpact!;
    expect(aff.label).toBe('警惕');
    expect(aff.confidence).toBe(0.7);
  });

  test('isContradiction defaults false and is honored when true', () => {
    expect(normalizeFact({}).isContradiction).toBe(false);
    expect(normalizeFact({ isContradiction: true }).isContradiction).toBe(true);
  });
});

describe('computeFactWriteOp — insert', () => {
  test('produces ST row with frequency=1, source=op-a, pinned=isContradiction, history with messageId', () => {
    const fact = normalizeFact({
      factText: '他自称叫李平。',
      decision: 'insert',
      importance: 4,
      isContradiction: false,
      keywords: [{ keyword: '陌生', assocRatio: 0.8 }],
      affectImpact: { label: '警惕', intensity: 0.5, confidence: 0.8 },
    });
    const result = computeFactWriteOp({
      fact,
      resolvedEntity: 'p:other',
      existing: null,
      owner: { playerId: 'p:owner', agentId: 'a:owner' },
      now: 5000,
      messageId: 'm:123',
    });
    expect(result.write.kind).toBe('insert');
    if (result.write.kind !== 'insert') return;
    const row = result.write.row;
    expect(row.tier).toBe('ST');
    expect(row.source).toBe('op-a');
    expect(row.frequency).toBe(1);
    expect(row.importance).toBe(4);
    expect(row.entity).toBe('p:other');
    expect(row.pinned).toBe(false);
    expect(row.factText).toBe('他自称叫李平。');
    expect(row.history).toHaveLength(1);
    expect(row.history[0].src).toEqual({ kind: 'msg', messageId: 'm:123' });
    expect(row.affectImpact?.label).toBe('警惕');
    expect(result.refireImpact?.label).toBe('警惕');
  });

  test('isContradiction=true → row inserted with pinned=true', () => {
    const fact = normalizeFact({ factText: '名字对不上。', isContradiction: true });
    const result = computeFactWriteOp({
      fact,
      resolvedEntity: 'p:other',
      existing: null,
      owner: { playerId: 'p:owner', agentId: 'a:owner' },
      now: 0,
    });
    if (result.write.kind !== 'insert') throw new Error();
    expect(result.write.row.pinned).toBe(true);
  });

  test('insert requires non-empty factText (throws on empty)', () => {
    const fact = normalizeFact({ factText: '   ' });
    expect(() =>
      computeFactWriteOp({
        fact,
        resolvedEntity: '__general__',
        existing: null,
        owner: { playerId: 'p:1', agentId: 'a:1' },
        now: 0,
      }),
    ).toThrow(/non-empty/);
  });
});

describe('computeFactWriteOp — exact (N27 monotonic rise + N26 merge)', () => {
  test('patches frequency++, lastUpdatedAt=now, history appended, importance max-rule', () => {
    const fact = normalizeFact({
      decision: 'exact',
      importance: 5, // higher than existing
      keywords: [{ keyword: '熟人', assocRatio: 0.7 }],
      affectImpact: { label: '安心', intensity: 0.3, confidence: 0.6 },
    });
    const existing = existingRow({ importance: 3, frequency: 2 });
    const result = computeFactWriteOp({
      fact,
      resolvedEntity: 'p:other',
      existing,
      owner: { playerId: 'p:owner', agentId: 'a:owner' },
      now: 7000,
      messageId: 'm:456',
    });
    expect(result.write.kind).toBe('patch');
    if (result.write.kind !== 'patch') return;
    expect(result.write.id).toBe('kf:existing');
    expect(result.write.patch.frequency).toBe(3); // 2 + 1
    expect(result.write.patch.lastUpdatedAt).toBe(7000);
    expect(result.write.patch.importance).toBe(5); // max(3, 5)
    // keywords merged via N26: 陌生 (existing) ∪ 熟人 (new)
    expect(result.write.patch.keywords).toEqual(
      expect.arrayContaining([
        { keyword: '陌生', assocRatio: 0.5 },
        { keyword: '熟人', assocRatio: 0.7 },
      ]),
    );
  });

  test('N27 monotonic: lower-importance new fact does NOT lower existing', () => {
    const fact = normalizeFact({ decision: 'exact', importance: 1 });
    const existing = existingRow({ importance: 4 });
    const result = computeFactWriteOp({
      fact,
      resolvedEntity: 'p:1',
      existing,
      owner: { playerId: 'p:0', agentId: 'a:0' },
      now: 0,
    });
    if (result.write.kind !== 'patch') throw new Error();
    expect(result.write.patch.importance).toBe(4); // existing wins
  });

  test('contradiction flag pins on re-encounter (sticks once set)', () => {
    const fact = normalizeFact({ decision: 'exact', isContradiction: true });
    const existing = existingRow({ pinned: false });
    const result = computeFactWriteOp({
      fact,
      resolvedEntity: 'p:1',
      existing,
      owner: { playerId: 'p:0', agentId: 'a:0' },
      now: 0,
    });
    if (result.write.kind !== 'patch') throw new Error();
    expect(result.write.patch.pinned).toBe(true);
  });

  test('exact without existing → throws', () => {
    const fact = normalizeFact({ decision: 'exact' });
    expect(() =>
      computeFactWriteOp({
        fact,
        resolvedEntity: 'p:1',
        existing: null,
        owner: { playerId: 'p:0', agentId: 'a:0' },
        now: 0,
      }),
    ).toThrow(/existing row but none/);
  });
});

describe('computeFactWriteOp — partial (inline merge prose required)', () => {
  test('patches factText to mergedFactText; frequency++; keywords are LLM-emitted post-merge list', () => {
    const fact = normalizeFact({
      decision: 'partial',
      mergedFactText: '他先后说自己叫「李平」和「李星平」。',
      importance: 4,
      keywords: [{ keyword: '名字', assocRatio: 0.9 }],
      isContradiction: true,
    });
    const existing = existingRow({ factText: '他自称叫李平。', importance: 3 });
    const result = computeFactWriteOp({
      fact,
      resolvedEntity: 'p:other',
      existing,
      owner: { playerId: 'p:owner', agentId: 'a:owner' },
      now: 8000,
    });
    if (result.write.kind !== 'patch') throw new Error();
    expect(result.write.patch.factText).toBe('他先后说自己叫「李平」和「李星平」。');
    expect(result.write.patch.frequency).toBe(3);
    expect(result.write.patch.importance).toBe(4); // max-rule
    expect(result.write.patch.pinned).toBe(true); // contradiction propagated
    // Op A emits post-merge list inline; we store directly (no re-merge)
    expect(result.write.patch.keywords).toEqual([{ keyword: '名字', assocRatio: 0.9 }]);
  });

  test('partial without mergedFactText → throws (per plan §5.1 contract)', () => {
    const fact = normalizeFact({ decision: 'partial', mergedFactText: null });
    expect(() =>
      computeFactWriteOp({
        fact,
        resolvedEntity: 'p:1',
        existing: existingRow(),
        owner: { playerId: 'p:0', agentId: 'a:0' },
        now: 0,
      }),
    ).toThrow(/mergedFactText/);
  });
});

describe('computeFactWriteOp — lt-only (L7 refresh-copy with sourceFactId)', () => {
  test('emits refresh-copy: ST row with sourceFactId back-pointing at LT original; source=op-a even when LT is instinct', () => {
    const fact = normalizeFact({
      decision: 'lt-only',
      importance: 3,
      keywords: [{ keyword: '陌生', assocRatio: 0.7 }],
      affectImpact: { label: '警惕', intensity: 0.4, confidence: 0.6 },
    });
    const ltInstinct = existingRow({
      tier: 'LT',
      source: 'instinct',
      _id: 'kf:I-SAF-1',
      factText: '到了陌生地方，本能上先看清出入口。',
      importance: 3,
      frequency: 1,
      pinned: true,
    });
    const result = computeFactWriteOp({
      fact,
      resolvedEntity: '__general__',
      existing: ltInstinct,
      owner: { playerId: 'p:owner', agentId: 'a:owner' },
      now: 9000,
    });
    expect(result.write.kind).toBe('refresh-copy');
    if (result.write.kind !== 'refresh-copy') return;
    expect(result.write.sourceLtId).toBe('kf:I-SAF-1');
    expect(result.write.row.tier).toBe('ST');
    expect(result.write.row.source).toBe('op-a'); // N28 — copy is op-a, not instinct
    expect(result.write.row.sourceFactId).toBe('kf:I-SAF-1'); // back-pointer for Op B C1 guard
    expect(result.write.row.frequency).toBe(2); // LT.frequency + 1
    expect(result.write.row.pinned).toBe(true); // inherit pin from LT
    expect(result.write.row.factText).toBe('到了陌生地方，本能上先看清出入口。');
    expect(result.write.row.instinctSlotKey).toBeUndefined(); // ST copy never carries slot
  });

  test('lt-only on row with tier=ST → throws', () => {
    const fact = normalizeFact({ decision: 'lt-only' });
    const stRow = existingRow({ tier: 'ST' });
    expect(() =>
      computeFactWriteOp({
        fact,
        resolvedEntity: 'p:1',
        existing: stRow,
        owner: { playerId: 'p:0', agentId: 'a:0' },
        now: 0,
      }),
    ).toThrow(/tier=ST.*expected LT/);
  });

  test('lt-only without existing → throws', () => {
    const fact = normalizeFact({ decision: 'lt-only' });
    expect(() =>
      computeFactWriteOp({
        fact,
        resolvedEntity: 'p:1',
        existing: null,
        owner: { playerId: 'p:0', agentId: 'a:0' },
        now: 0,
      }),
    ).toThrow(/LT row but none/);
  });
});

describe('resolveEntity', () => {
  const map = new Map([
    ['琳娜', 'p:lina'],
    ['李平', 'p:liping'],
  ]);

  test('exact display-name match → playerId', () => {
    expect(resolveEntity('琳娜', '', map)).toBe('p:lina');
  });

  test('entity raw == __general__ → sentinel', () => {
    expect(resolveEntity('', '__general__', map)).toBe('__general__');
  });

  test('entityRaw matches display name (fallback when displayName empty) → playerId', () => {
    expect(resolveEntity('', '李平', map)).toBe('p:liping');
  });

  test('no match anywhere → __general__ (safe fallback)', () => {
    expect(resolveEntity('张三', '', map)).toBe('__general__');
    expect(resolveEntity('', 'unknown', map)).toBe('__general__');
  });

  test('displayName takes precedence over entityRaw', () => {
    expect(resolveEntity('琳娜', '李平', map)).toBe('p:lina');
  });
});

describe('findExactDupInST (pre-LLM short-circuit option b)', () => {
  const rows: Array<KnowledgeFactView & { _id: string }> = [
    existingRow({ _id: 'kf:1', tier: 'ST', factText: '他自称叫李平。' }),
    existingRow({ _id: 'kf:2', tier: 'ST', factText: '他戴着眼镜。' }),
    existingRow({ _id: 'kf:3', tier: 'LT', factText: '他自称叫李平。' }), // LT — should be ignored
  ];

  test('byte-exact ST match → row id', () => {
    expect(findExactDupInST('他自称叫李平。', rows)).toBe('kf:1');
  });

  test('whitespace difference (trim symmetry) → still matches', () => {
    expect(findExactDupInST('  他自称叫李平。  ', rows)).toBe('kf:1');
  });

  test('LT row with same text → null (only ST counts)', () => {
    // The above 'kf:1' is ST and matches first; remove ST candidate.
    const ltOnly = rows.filter((r) => r.tier === 'LT');
    expect(findExactDupInST('他自称叫李平。', ltOnly)).toBeNull();
  });

  test('no match → null', () => {
    expect(findExactDupInST('完全不同的事实', rows)).toBeNull();
  });

  test('empty input → null', () => {
    expect(findExactDupInST('', rows)).toBeNull();
    expect(findExactDupInST('   ', rows)).toBeNull();
  });
});
