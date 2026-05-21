// Memory v3.5 — pure helpers for the tiered Knowledge-DB.
//
// Everything in here is synchronous, free of Convex context, and
// unit-testable in isolation. The Op A internalAction (and any future
// Op B / Op C handlers) consumes these helpers for the deterministic
// outer-layer work — normalization, scoring, sort/truncate, N24 gating —
// so the only side-effecting code lives in the Convex callers.
//
// Type policy: the helpers work over a STRUCTURAL `KnowledgeFactView`
// rather than `Doc<'knowledgeFact'>` so tests can hand-author fixtures
// without spinning up a Convex schema. Convex `Doc<'knowledgeFact'>`
// satisfies this view (extra fields are ignored).

import {
  KNOWLEDGE_FACT_MAX_KEYWORDS,
  KNOWLEDGE_KEYWORD_MAX_CHARS,
  KNOWLEDGE_IMPORTANCE_MIN,
  KNOWLEDGE_IMPORTANCE_MAX,
  KNOWLEDGE_IMPORTANCE_DEFAULT,
  N24_REFIRE_PERF_FLOOR,
  RECENCY_HALFLIFE_MS,
  INSTINCT_RENDER_FLOOR,
} from '../constants';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type Keyword = { keyword: string; assocRatio: number };

export type AffectImpact = {
  label: string;
  intensity: number; // 0..1 emotion-like; -1..1 affection-like
  confidence: number; // 0..1
  targetEntity?: string | null;
};

export type FactSource = 'op-a' | 'instinct';
export type FactTier = 'ST' | 'LT';

/**
 * Structural view used by the pure helpers. A real `Doc<'knowledgeFact'>`
 * satisfies this. Fields not used by any helper are omitted from the
 * view to keep test fixtures small.
 */
export type KnowledgeFactView = {
  tier: FactTier;
  source: FactSource;
  importance: number;
  frequency: number;
  lastUpdatedAt: number;
  pinned: boolean;
  keywords?: Keyword[];
  factText?: string;
  affectImpact?: AffectImpact | null;
};

// ─────────────────────────────────────────────────────────────────────
// N26 keyword layer — normalization + deterministic merge contract
// ─────────────────────────────────────────────────────────────────────

/**
 * Per the Memory plan §5.1 outer-layer step 2 (N26):
 *   trim → drop if empty → clamp assocRatio to [0,1] →
 *   truncate keyword to KNOWLEDGE_KEYWORD_MAX_CHARS chars →
 *   de-dup (case-insensitive byte-equal; on collision take max ratio) →
 *   truncate list to KNOWLEDGE_FACT_MAX_KEYWORDS by descending ratio,
 *   tiebreak first-occurrence wins (stable sort over original order).
 *
 * Non-finite ratios are treated as 0 (defensive against NaN/Infinity from
 * malformed Grok output).
 */
export function normalizeKeywords(input: readonly Partial<Keyword>[] | undefined): Keyword[] {
  if (!input || input.length === 0) return [];

  // Step 1: trim text, clamp ratio, truncate text, drop empties.
  type Stage = { keyword: string; lower: string; assocRatio: number; firstIdx: number };
  const staged: Stage[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    const rawText = (raw?.keyword ?? '').trim();
    if (!rawText) continue;
    const truncated =
      rawText.length > KNOWLEDGE_KEYWORD_MAX_CHARS
        ? rawText.slice(0, KNOWLEDGE_KEYWORD_MAX_CHARS)
        : rawText;
    let ratio = Number(raw?.assocRatio ?? 0);
    if (!Number.isFinite(ratio)) ratio = 0;
    if (ratio < 0) ratio = 0;
    else if (ratio > 1) ratio = 1;
    staged.push({
      keyword: truncated,
      lower: truncated.toLowerCase(),
      assocRatio: ratio,
      firstIdx: i,
    });
  }

  // Step 2: de-dup case-insensitive; on collision take max ratio,
  // keep the first-seen text + first-seen index (for tiebreak stability).
  const byLower = new Map<string, Stage>();
  for (const s of staged) {
    const prev = byLower.get(s.lower);
    if (!prev) byLower.set(s.lower, s);
    else if (s.assocRatio > prev.assocRatio)
      byLower.set(s.lower, { ...prev, assocRatio: s.assocRatio });
  }

  // Step 3: truncate to KNOWLEDGE_FACT_MAX_KEYWORDS by descending ratio,
  // tiebreak by firstIdx ascending (first-occurrence wins).
  const arr = Array.from(byLower.values()).sort((a, b) => {
    if (b.assocRatio !== a.assocRatio) return b.assocRatio - a.assocRatio;
    return a.firstIdx - b.firstIdx;
  });
  const top = arr.slice(0, KNOWLEDGE_FACT_MAX_KEYWORDS);
  return top.map(({ keyword, assocRatio }) => ({ keyword, assocRatio }));
}

/**
 * N26 deterministic merge contract — applied on every merge site that
 * lacks an LLM-supplied merged list (Op B's optional merged keywords,
 * Op C's optional merged keywords, and the Op A `exact`-decision when
 * Grok omits the keywords field).
 *
 * Contract: union by case-insensitive key; on collision take max ratio,
 * keep the first-seen text from `a` (caller decides which side comes
 * first — Op B passes LT-then-ST, Op C passes by-recency). After union,
 * normalize the combined list through `normalizeKeywords` (clamp,
 * truncate, sort).
 */
export function mergeKeywords(a: Keyword[] | undefined, b: Keyword[] | undefined): Keyword[] {
  const combined: Keyword[] = [];
  if (a) combined.push(...a);
  if (b) combined.push(...b);
  return normalizeKeywords(combined);
}

// ─────────────────────────────────────────────────────────────────────
// N27 — importance normalization (Park-style 1..5 integer)
// ─────────────────────────────────────────────────────────────────────

/**
 * Clamp to [MIN, MAX], round to integer, fill default on missing /
 * NaN / Infinity. Returns an integer in [KNOWLEDGE_IMPORTANCE_MIN,
 * KNOWLEDGE_IMPORTANCE_MAX].
 */
export function normalizeImportance(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return KNOWLEDGE_IMPORTANCE_DEFAULT;
  const rounded = Math.round(x);
  if (rounded < KNOWLEDGE_IMPORTANCE_MIN) return KNOWLEDGE_IMPORTANCE_MIN;
  if (rounded > KNOWLEDGE_IMPORTANCE_MAX) return KNOWLEDGE_IMPORTANCE_MAX;
  return rounded;
}

/**
 * N27 monotonic-rise on merge sites: importance never falls on
 * re-encounter (Op A exact / partial / lt-only; Op B promote/merge;
 * Op C C1 compaction). Returns max of two normalized importances.
 */
export function maxImportance(a: unknown, b: unknown): number {
  return Math.max(normalizeImportance(a), normalizeImportance(b));
}

// ─────────────────────────────────────────────────────────────────────
// affectImpact normalization (Rec 6 confidence default; N24 gate)
// ─────────────────────────────────────────────────────────────────────

/**
 * Op A's outer-layer step 4: clamp confidence to [0,1]; if missing →
 * 0.5 (neutral / unknown confidence). intensity is clamped to its
 * natural range by the caller (-1..1 for affection-like; 0..1 for
 * emotion-like) — this helper does NOT impose intensity bounds since
 * label semantics are caller-known.
 *
 * Returns null when the input is itself null/undefined OR has no label
 * (a structurally empty payload).
 */
export function normalizeAffectImpact(
  input: Partial<AffectImpact> | null | undefined,
): AffectImpact | null {
  if (!input) return null;
  const label = (input.label ?? '').trim();
  if (!label) return null;
  let intensity = Number(input.intensity ?? 0);
  if (!Number.isFinite(intensity)) intensity = 0;
  if (intensity < -1) intensity = -1;
  else if (intensity > 1) intensity = 1;
  let confidence = Number(input.confidence ?? 0.5);
  if (!Number.isFinite(confidence)) confidence = 0.5;
  if (confidence < 0) confidence = 0;
  else if (confidence > 1) confidence = 1;
  return {
    label,
    intensity,
    confidence,
    targetEntity: input.targetEntity ?? null,
  };
}

/**
 * N24 (v3.4 C9) — multiplicative scaling. Every re-fire fires; the
 * value APPLIED to mindState is `intensity × confidence`. The
 * `N24_REFIRE_PERF_FLOOR` is a PERF-ONLY skip: re-fires with
 * `|intensity × confidence| < floor` contribute negligible affect
 * delta, so the engine elects to skip the round-trip rather than
 * spend a mutation on noise. This is NOT a cognitive contract.
 *
 * Returns `{ applied: number, shouldRefire: boolean }`. `applied`
 * preserves the SIGN of intensity (so callers can apply directly to
 * affection deltas — negative values shift toward dislike).
 */
export function n24Scale(impact: AffectImpact | null | undefined): {
  applied: number;
  shouldRefire: boolean;
} {
  if (!impact) return { applied: 0, shouldRefire: false };
  const applied = impact.intensity * impact.confidence;
  const shouldRefire = Math.abs(applied) >= N24_REFIRE_PERF_FLOOR;
  return { applied, shouldRefire };
}

// ─────────────────────────────────────────────────────────────────────
// §6 render scoring + sort
// ─────────────────────────────────────────────────────────────────────

/**
 * v3.2 (Rec 2 / Park et al §4.1) three-factor recall score:
 *   score = importance × frequency × exp(-Δt / RECENCY_HALFLIFE_MS).
 * `Δt = max(0, now - lastUpdatedAt)`; negative gaps (clock skew /
 * future-dated test fixtures) clamp to 0 (no boost beyond fresh).
 */
export function factScore(row: KnowledgeFactView, now: number): number {
  const dt = Math.max(0, now - row.lastUpdatedAt);
  const decay = Math.exp(-dt / RECENCY_HALFLIFE_MS);
  return row.importance * row.frequency * decay;
}

/**
 * Per-target §6 render order (Memory plan §6 / N22):
 *   1. pinned === true first (under 【冲突信息】 sub-header); among
 *      pinned, most-recent `lastUpdatedAt` first.
 *   2. Then non-pinned, sorted by `factScore` descending. Up to
 *      `budget - pinnedCount(clamped to ⌈budget/2⌉)`.
 *   3. Whole block hard-capped at `budget`; if pinned alone exceeds
 *      half the budget, pinned is truncated by recency (NOT by
 *      dropping non-pinned — the alternative would hide currently-
 *      relevant facts behind stale contradictions).
 *
 * Returns `{ pinned, normal }` so the renderer can emit the sub-header
 * only when `pinned.length > 0`. Combined length ≤ `budget`.
 */
export function sortPerTargetFacts<T extends KnowledgeFactView>(
  facts: readonly T[],
  now: number,
  budget: number,
): { pinned: T[]; normal: T[] } {
  if (budget <= 0) return { pinned: [], normal: [] };
  const pinnedHalfCap = Math.ceil(budget / 2);

  const pinnedAll: T[] = [];
  const normalAll: T[] = [];
  for (const f of facts) (f.pinned ? pinnedAll : normalAll).push(f);

  // pinned: most-recent first.
  pinnedAll.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
  const pinned = pinnedAll.slice(0, Math.min(pinnedAll.length, pinnedHalfCap));

  // normal: factScore desc, tiebreak by lastUpdatedAt desc for stability.
  normalAll.sort((a, b) => {
    const sa = factScore(a, now);
    const sb = factScore(b, now);
    if (sb !== sa) return sb - sa;
    return b.lastUpdatedAt - a.lastUpdatedAt;
  });
  const normal = normalAll.slice(0, Math.max(0, budget - pinned.length));

  return { pinned, normal };
}

/**
 * General-knowledge §6 render order (Memory plan §6 v3.4 — render-
 * policy reconcile):
 *   1. Compute score for every row in the merged ST+LT general slice.
 *   2. Sort descending by score; on tie, `source: 'op-a'` wins over
 *      `source: 'instinct'` (Lens 2 REC-3 — lived experience first).
 *   3. Take top `budget`.
 *   4. Enforce `INSTINCT_RENDER_FLOOR = 2`: if fewer than the floor
 *      instinct rows are in the top-N, evict the lowest-scoring non-
 *      instinct rows and substitute the highest-scoring instincts not
 *      already selected, until either the floor is met OR the instinct
 *      pool is exhausted.
 *   5. Within the final selection, sort by descending score again so
 *      the rendered order reflects post-floor ranking (not the
 *      pre-floor cut).
 */
export function sortGeneralFacts<T extends KnowledgeFactView>(
  facts: readonly T[],
  now: number,
  budget: number,
  floor: number = INSTINCT_RENDER_FLOOR,
): T[] {
  if (budget <= 0) return [];

  // Score everything once.
  type Scored = { row: T; score: number };
  const scored: Scored[] = facts.map((row) => ({ row, score: factScore(row, now) }));
  // Sort desc by score; on tie op-a > instinct (Lens 2 REC-3).
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.row.source !== b.row.source) {
      // op-a should come first; treat 'op-a' as lower string compare
      // result irrelevant — branch explicitly to be safe.
      return a.row.source === 'op-a' ? -1 : 1;
    }
    return b.row.lastUpdatedAt - a.row.lastUpdatedAt;
  });

  const top = scored.slice(0, budget);
  const remaining = scored.slice(budget);

  const instinctInTop = top.filter((s) => s.row.source === 'instinct').length;
  const needed = Math.max(0, floor - instinctInTop);
  if (needed === 0) return top.map((s) => s.row);

  const extraInstincts = remaining.filter((s) => s.row.source === 'instinct').slice(0, needed);
  if (extraInstincts.length === 0) return top.map((s) => s.row);

  // Evict the lowest-scoring NON-instinct rows from `top` to make room.
  // Sort top by score ASC (lowest first) but only over non-instinct;
  // we keep the highest-scoring non-instincts.
  const opaInTop = top.filter((s) => s.row.source !== 'instinct');
  opaInTop.sort((a, b) => a.score - b.score); // lowest first
  const toEvict = new Set<T>();
  for (let i = 0; i < extraInstincts.length && i < opaInTop.length; i++) {
    toEvict.add(opaInTop[i].row);
  }

  const kept = top.filter((s) => !toEvict.has(s.row));
  const final = [...kept, ...extraInstincts];

  // Final order: descending score (stable).
  final.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.row.source !== b.row.source) return a.row.source === 'op-a' ? -1 : 1;
    return b.row.lastUpdatedAt - a.row.lastUpdatedAt;
  });

  return final.map((s) => s.row);
}

// ─────────────────────────────────────────────────────────────────────
// __general__ Op A match-slice budgeting (v3.4 C7 two-budget rule)
// ─────────────────────────────────────────────────────────────────────

/**
 * Op A's per-fact LT slice budgeting for entity === '__general__'.
 * Partitions input into instinct + op-a rows; applies separate char
 * budgets. Within the instinct budget, applies a deterministic
 * keyword-overlap pre-filter against `inputKeywords` (the new fact's
 * keywords, best-effort; empty fallback ⇒ recency order).
 *
 * Returns the union (instincts selected by overlap + ALL op-a rows
 * truncated to op-a budget by recency). Caller passes the result into
 * Grok's prompt; non-`__general__` entities use a flat 800-char slice
 * (separate helper, not this one).
 */
export function selectGeneralSliceInstincts<T extends KnowledgeFactView>(
  rows: readonly T[],
  inputKeywords: readonly Keyword[],
  budgetChars: number,
): T[] {
  const instincts = rows.filter((r) => r.source === 'instinct');
  if (instincts.length === 0 || budgetChars <= 0) return [];

  // Score each instinct by |intersection(instinct.keywords, inputKeywords)|.
  // Case-insensitive on keyword text.
  const inputSet = new Set<string>();
  for (const k of inputKeywords ?? []) {
    const kw = (k?.keyword ?? '').trim().toLowerCase();
    if (kw) inputSet.add(kw);
  }
  type Scored = { row: T; overlap: number };
  const scored: Scored[] = instincts.map((row) => {
    let overlap = 0;
    for (const k of row.keywords ?? []) {
      const kw = (k?.keyword ?? '').trim().toLowerCase();
      if (kw && inputSet.has(kw)) overlap++;
    }
    return { row, overlap };
  });

  // Sort desc overlap; tiebreak ascending lastUpdatedAt (oldest first
  // for fairness across the manifest — per plan §5.1 v3.4).
  scored.sort((a, b) => {
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    return a.row.lastUpdatedAt - b.row.lastUpdatedAt;
  });

  const selected: T[] = [];
  let usedChars = 0;
  for (const s of scored) {
    const len = (s.row.factText ?? '').length;
    if (usedChars + len > budgetChars && selected.length > 0) break;
    selected.push(s.row);
    usedChars += len;
    if (usedChars >= budgetChars) break;
  }
  return selected;
}

// ─────────────────────────────────────────────────────────────────────
// Test-only export (re-exported by knowledgeFacts.test.ts)
// ─────────────────────────────────────────────────────────────────────

export const __test = {
  factScore,
};
