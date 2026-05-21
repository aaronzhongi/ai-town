// Memory v3.5 — INSTINCT_MANIFEST integrity + helper unit tests.
//
// Covers the manifest's structural invariants (15 universal entries,
// universal-prefix slot keys, unique keys, char-budget compliance,
// __general__ entity, every entry passes through normalizeKeywords
// cleanly) plus the two pure helpers (`buildInstinctRow`,
// `filterManifestByLevels`). The `seedBasicInstincts` mutation
// itself is exercised in 2A.0 cutover smoke testing, not here —
// the Convex action context is not available in jest unit-test land.

import {
  INSTINCT_MANIFEST,
  InstinctSeed,
  MaslowLevel,
  buildInstinctRow,
  filterManifestByLevels,
} from './instincts';
import { normalizeKeywords } from './knowledgeFacts';
import {
  KNOWLEDGE_FACT_MAX_CHARS,
  KNOWLEDGE_FACT_MAX_KEYWORDS,
  KNOWLEDGE_KEYWORD_MAX_CHARS,
  KNOWLEDGE_LT_INSTINCT_RESERVE,
} from '../constants';

describe('INSTINCT_MANIFEST structural integrity', () => {
  test('has exactly KNOWLEDGE_LT_INSTINCT_RESERVE entries (= 15 universal post-2026-05-21)', () => {
    expect(INSTINCT_MANIFEST.length).toBe(KNOWLEDGE_LT_INSTINCT_RESERVE);
    expect(INSTINCT_MANIFEST.length).toBe(15);
  });

  test('every slot key starts with I- (universal-only; no O- overlays per scope decision)', () => {
    for (const seed of INSTINCT_MANIFEST) {
      expect(seed.slotKey.startsWith('I-')).toBe(true);
      expect(seed.slotKey.startsWith('O-')).toBe(false);
    }
  });

  test('all 15 slot keys are unique', () => {
    const seen = new Set<string>();
    for (const seed of INSTINCT_MANIFEST) {
      expect(seen.has(seed.slotKey)).toBe(false);
      seen.add(seed.slotKey);
    }
    expect(seen.size).toBe(INSTINCT_MANIFEST.length);
  });

  test('coverage check vs Memory plan §13.2: 3 phys / 5 safety / 3 belonging / 2 esteem / 2 selfActual', () => {
    const counts: Record<MaslowLevel, number> = {
      physiological: 0,
      safety: 0,
      belonging: 0,
      esteem: 0,
      selfActualization: 0,
    };
    for (const seed of INSTINCT_MANIFEST) counts[seed.primaryLevel]++;
    expect(counts.physiological).toBe(3);
    expect(counts.safety).toBe(5);
    expect(counts.belonging).toBe(3);
    expect(counts.esteem).toBe(2);
    expect(counts.selfActualization).toBe(2);
  });

  test('every factText is ≤ KNOWLEDGE_FACT_MAX_CHARS and non-empty', () => {
    for (const seed of INSTINCT_MANIFEST) {
      const text = seed.factText.trim();
      expect(text.length).toBeGreaterThan(0);
      expect(seed.factText.length).toBeLessThanOrEqual(KNOWLEDGE_FACT_MAX_CHARS);
    }
  });

  test('every entry has entity=__general__ (research §3 universal scope)', () => {
    for (const seed of INSTINCT_MANIFEST) {
      expect(seed.entity).toBe('__general__');
    }
  });

  test('every entry has 1..KNOWLEDGE_FACT_MAX_KEYWORDS keywords, each in [0,1] ratio and ≤ KNOWLEDGE_KEYWORD_MAX_CHARS chars', () => {
    for (const seed of INSTINCT_MANIFEST) {
      expect(seed.keywords.length).toBeGreaterThan(0);
      expect(seed.keywords.length).toBeLessThanOrEqual(KNOWLEDGE_FACT_MAX_KEYWORDS);
      for (const kw of seed.keywords) {
        expect(kw.assocRatio).toBeGreaterThanOrEqual(0);
        expect(kw.assocRatio).toBeLessThanOrEqual(1);
        expect(kw.keyword.length).toBeGreaterThan(0);
        expect(kw.keyword.length).toBeLessThanOrEqual(KNOWLEDGE_KEYWORD_MAX_CHARS);
      }
    }
  });

  test('every entry survives normalizeKeywords with no LOSS / MUTATION (authoring order can be semantic; canonical-stored order is ratio-desc)', () => {
    // The contract we want is: normalization preserves the SET of
    // {keyword, ratio} pairs — no key dropped, no ratio mutated, no
    // length violations. Ordering may differ (authoring uses
    // semantic / thematic groupings for human readability; storage
    // is ratio-desc). If we ever WERE losing or mutating, the merge
    // sites would silently drift; that's what this guards against.
    for (const seed of INSTINCT_MANIFEST) {
      const normalized = normalizeKeywords(seed.keywords);
      expect(normalized.length).toBe(seed.keywords.length);
      const lookup = new Map(normalized.map((k) => [k.keyword.toLowerCase(), k.assocRatio]));
      for (const original of seed.keywords) {
        const stored = lookup.get(original.keyword.toLowerCase());
        expect(stored).toBeDefined();
        expect(stored).toBeCloseTo(original.assocRatio);
      }
    }
  });

  test('safety slot I-SAF-2 is the sex-neutral familiarity-anchor (replaces the user-flagged sex-keyed candidate)', () => {
    // Compile-time-locked invariant from the research §2 verdict:
    // the safety/familiarity instinct that survived audit is
    // sex-NEUTRAL ("熟人" / "认识或熟悉的人"), never sex-keyed.
    const isaf2 = INSTINCT_MANIFEST.find((s) => s.slotKey === 'I-SAF-2');
    expect(isaf2).toBeDefined();
    expect(isaf2!.factText).toMatch(/熟人|认识|熟悉/);
    expect(isaf2!.factText).not.toMatch(/男|男性/);
  });

  test('safety slot I-SAF-3 carries the empirically-honest female-specific wariness toward unfamiliar males', () => {
    // Research §2 verdict: the female-specific safety instinct that
    // the data supports is elevated wariness toward unfamiliar
    // males, not affiliation. Pin both halves of this invariant
    // (it's the most-contestable claim in the manifest, R1).
    const isaf3 = INSTINCT_MANIFEST.find((s) => s.slotKey === 'I-SAF-3');
    expect(isaf3).toBeDefined();
    expect(isaf3!.factText).toMatch(/男性/);
    expect(isaf3!.factText).toMatch(/警惕|留意/);
  });
});

describe('buildInstinctRow', () => {
  const seed: InstinctSeed = {
    slotKey: 'I-PHY-1',
    primaryLevel: 'physiological',
    factText: '饿了就要找吃的。',
    keywords: [{ keyword: '饥', assocRatio: 0.9 }],
    entity: '__general__',
  };
  const args = { ownerPlayerId: 'p:1', ownerAgentId: 'a:1', now: 1_700_000_000_000 };

  test('produces row with the v3.4 instinct invariants (tier=LT, source=instinct, pinned=true, importance=3, frequency=1, affectImpact=undefined)', () => {
    const row = buildInstinctRow(seed, args);
    expect(row.tier).toBe('LT');
    expect(row.source).toBe('instinct');
    expect(row.pinned).toBe(true);
    expect(row.importance).toBe(3); // v3.4 reconcile (not 5)
    expect(row.frequency).toBe(1);
    expect(row.affectImpact).toBeUndefined(); // N28 — instincts carry no inherent affect
  });

  test('copies slotKey + entity + factText verbatim; populates ownerPlayerId/ownerAgentId from args', () => {
    const row = buildInstinctRow(seed, args);
    expect(row.instinctSlotKey).toBe(seed.slotKey);
    expect(row.entity).toBe(seed.entity);
    expect(row.factText).toBe(seed.factText);
    expect(row.ownerPlayerId).toBe('p:1');
    expect(row.ownerAgentId).toBe('a:1');
  });

  test('sets createdAt = lastUpdatedAt = args.now; empty history; no sourceFactId / relatedInstinctId', () => {
    const row = buildInstinctRow(seed, args);
    expect(row.createdAt).toBe(args.now);
    expect(row.lastUpdatedAt).toBe(args.now);
    expect(row.history).toEqual([]);
    expect(row.sourceFactId).toBeUndefined();
    expect(row.relatedInstinctId).toBeUndefined();
  });

  test('passes keywords through normalizeKeywords (N26 contract)', () => {
    // Construct a seed whose keywords need normalization (excess + bad ratio).
    const dirtySeed: InstinctSeed = {
      ...seed,
      keywords: [
        { keyword: '  饥  ', assocRatio: 1.5 }, // ratio clamped, trimmed
        { keyword: '饥', assocRatio: 0.3 }, // de-dup collision, max wins
        { keyword: '', assocRatio: 0.5 }, // dropped (empty)
      ],
    };
    const row = buildInstinctRow(dirtySeed, args);
    expect(row.keywords).toEqual([{ keyword: '饥', assocRatio: 1 }]);
  });
});

describe('filterManifestByLevels', () => {
  test('"all" / undefined → entire manifest (copy, not the readonly original)', () => {
    const all = filterManifestByLevels(INSTINCT_MANIFEST, 'all');
    const undef = filterManifestByLevels(INSTINCT_MANIFEST, undefined);
    expect(all.length).toBe(INSTINCT_MANIFEST.length);
    expect(undef.length).toBe(INSTINCT_MANIFEST.length);
    expect(all).not.toBe(INSTINCT_MANIFEST); // copy, not alias
  });

  test('single-level filter selects only that level', () => {
    const phys = filterManifestByLevels(INSTINCT_MANIFEST, ['physiological']);
    expect(phys.length).toBe(3);
    for (const seed of phys) expect(seed.primaryLevel).toBe('physiological');

    const safety = filterManifestByLevels(INSTINCT_MANIFEST, ['safety']);
    expect(safety.length).toBe(5);
    for (const seed of safety) expect(seed.primaryLevel).toBe('safety');
  });

  test('multi-level filter unions the selected levels', () => {
    const bottomTwo = filterManifestByLevels(INSTINCT_MANIFEST, [
      'physiological',
      'safety',
    ]);
    expect(bottomTwo.length).toBe(3 + 5);
    for (const seed of bottomTwo) {
      expect(['physiological', 'safety']).toContain(seed.primaryLevel);
    }
  });

  test('empty filter array → empty result (operator explicitly selected no levels)', () => {
    expect(filterManifestByLevels(INSTINCT_MANIFEST, [])).toEqual([]);
  });
});
