// Memory v3.5 Op A — pure parse + normalize + decision-apply helpers.
//
// Everything in this module is synchronous and Convex-free, so the
// match-tree decision logic can be golden-vector tested without an
// LLM call or a Convex action context. The Convex-side glue
// (loadOpAContext / opAExtract / applyOpAResult in opA.ts) consumes
// these helpers; the LLM call sits at the seam between
// `safeParseOpAResponse` (input) and `computeFactWriteOp` (output).
//
// Naming pin: per plan §5.1 the four match-tree decisions are
// `insert | exact | partial | lt-only`. Identifiers here match
// verbatim so future readers can grep for the plan's vocabulary.

import { Doc } from '../_generated/dataModel';
import {
  AffectImpact,
  Keyword,
  KnowledgeFactView,
  normalizeKeywords,
  normalizeImportance,
  normalizeAffectImpact,
  mergeKeywords,
  maxImportance,
} from './knowledgeFacts';
import {
  KNOWLEDGE_FACT_MAX_CHARS,
  KNOWLEDGE_FACT_HISTORY_CAP,
} from '../constants';

// ─────────────────────────────────────────────────────────────────────
// Types (Grok JSON contract)
// ─────────────────────────────────────────────────────────────────────

export type OpADecision = 'insert' | 'exact' | 'partial' | 'lt-only';

/** Per-fact entry as emitted by Grok (post-parse, pre-normalize). */
export type OpAFactRaw = {
  entity?: string;
  entityDisplayName?: string;
  factText?: string;
  /** 2A.10: Grok occasionally emits `fact` instead of `factText`
   *  (trial-3 surfaced — defensive alias per Bug A). */
  fact?: string;
  decision?: OpADecision;
  existingFactId?: string | null;
  isContradiction?: boolean;
  mergedFactText?: string | null;
  importance?: number;
  affectImpact?: Partial<AffectImpact> | null;
  keywords?: Partial<Keyword>[];
};

/** Global per-turn affect block (N23 application). */
export type OpAAffectRaw = {
  emotion?: { label?: string; intensity?: number } | null;
  affectionDelta?: number;
  targetEntity?: string | null;
};

/** Top-level Grok response shape. */
export type OpAResponseRaw = {
  facts?: OpAFactRaw[];
  affect?: OpAAffectRaw;
};

/**
 * Best-effort parse of a Grok content string into the strict
 * `OpAResponseRaw` shape. Tolerant of common malformations:
 *   - Markdown code fences around the JSON (```json … ```)
 *   - Leading / trailing prose around the JSON object
 *   - Missing `facts` array (defaults to `[]`)
 *   - Missing `affect` block (defaults to undefined)
 *   - **2A.10 Bug B**: truncated mid-response (e.g. OP_A_MAX_TOKENS
 *     hit). Recovery walker finds the last complete fact at facts-
 *     array depth, truncates to that point + closes the JSON. Yields
 *     N-1 facts instead of dropping the entire batch.
 * Throws only when the content has no parseable `{ … }` substring AND
 * the recovery walker can't find any complete fact either.
 */
export function safeParseOpAResponse(content: string): OpAResponseRaw {
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('Op A: empty Grok response content');
  }
  // Strip code fences if present (```json … ``` or ``` … ```).
  let stripped = content.trim();
  const fenceMatch = stripped.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) stripped = fenceMatch[1].trim();

  // Find the first `{` and the matching closing `}` by brace counting
  // (string-aware). Safe for nested objects + braces inside strings.
  const start = stripped.indexOf('{');
  if (start < 0) throw new Error('Op A: no JSON object found in response');

  const fullEnd = findMatchingBrace(stripped, start);
  if (fullEnd >= 0) {
    // Happy path: closed JSON object found.
    return parseOpAObject(stripped.slice(start, fullEnd + 1));
  }

  // 2A.10 Bug B recovery: trial-3 showed Grok hitting OP_A_MAX_TOKENS
  // mid-response, leaving the JSON unclosed. Walk the string at
  // facts-array depth (=2 inside the outer object's `facts: [...]`),
  // find the last complete fact's closing `}`, truncate + close.
  const recovered = tryRecoverTruncatedOpA(stripped.slice(start));
  if (recovered !== null) {
    console.warn(
      '[Op A safeParse] recovered from truncated response — used the last complete fact set',
    );
    return recovered;
  }
  throw new Error('Op A: unclosed JSON object in response');
}

/** String-aware brace matcher. Returns the index of the matching `}`
 *  for the `{` at `start`, or -1 if unclosed. */
function findMatchingBrace(s: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Common post-parse normalization for an already-extracted JSON
 *  object string. Validates top-level shape + defaults missing fields. */
function parseOpAObject(jsonStr: string): OpAResponseRaw {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Op A: JSON.parse failed: ${(e as Error).message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Op A: parsed JSON is not an object');
  }
  const facts = Array.isArray(parsed.facts) ? parsed.facts : [];
  const affect =
    parsed.affect && typeof parsed.affect === 'object' ? parsed.affect : undefined;
  return { facts, affect };
}

/**
 * 2A.10 Bug B truncated-response recovery. The input starts with the
 * opening `{` of the top-level Op A response. Walks the string
 * (string-aware), tracks brace depth, and finds the last position
 * where depth == 1 right AFTER closing `}` (i.e., the end of a
 * complete fact object inside `facts: [`). Truncates to that point
 * and appends `]}` to close the facts array + outer object.
 *
 * Returns the parsed OpAResponseRaw on success, or null when no
 * recovery is possible (e.g., truncation hit before even one
 * complete fact closed, or the brace-walk never reached depth 2).
 */
function tryRecoverTruncatedOpA(s: string): OpAResponseRaw | null {
  if (s.length === 0 || s[0] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  let lastFactEnd = -1; // index of `}` that closed a fact at depth-2
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      // depth was 2 (inside facts:[...] then inside a fact object) and
      // we just closed → now at depth 1. That's the end of a fact.
      if (depth === 1) lastFactEnd = i;
    }
  }
  if (lastFactEnd < 0) return null;

  // Build the recovered JSON: everything up through the last complete
  // fact, then close the facts array + outer object. Affect block is
  // lost when the response was truncated mid-facts (Grok hadn't
  // emitted it yet — accept this; better partial than nothing).
  const truncated = s.slice(0, lastFactEnd + 1);
  const recovered = `${truncated}]}`;
  try {
    return parseOpAObject(recovered);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Per-fact normalization
// ─────────────────────────────────────────────────────────────────────

export type OpAFactNormalized = {
  /** Display-name resolution happens in the Convex layer; we keep the
   *  raw name here for the mutation to translate. */
  entityDisplayName: string;
  /** Pre-resolved playerId if entity was already a real id (rare). */
  entityRaw: string;
  factText: string;
  decision: OpADecision;
  existingFactId: string | null;
  isContradiction: boolean;
  mergedFactText: string | null;
  importance: number;
  affectImpact: AffectImpact | null;
  keywords: Keyword[];
};

/**
 * Pull the raw fact through the outer-layer step 2-4 (keywords →
 * importance → confidence). Per-decision invariants (e.g. `merged`
 * required on `partial`/`lt-only`) are checked downstream so that
 * normalization remains side-effect free; this function does NOT
 * reject — it produces a maximally-charitable normalized form +
 * leaves validation to `computeFactWriteOp`.
 *
 * Per plan §5.1 step 1: `entityDisplayName` is the LLM's emission;
 * the outer code translates display name → playerId. We carry both
 * `entityDisplayName` (preferred) and `entityRaw` (fallback) so the
 * Convex layer can do the lookup.
 *
 * factText is trimmed; if longer than KNOWLEDGE_FACT_MAX_CHARS it is
 * truncated (mutation-side enforcement per plan §3.1 RC1).
 */
export function normalizeFact(raw: OpAFactRaw): OpAFactNormalized {
  const trimFactText = (s: string | undefined): string => {
    const t = (s ?? '').trim();
    return t.length > KNOWLEDGE_FACT_MAX_CHARS
      ? t.slice(0, KNOWLEDGE_FACT_MAX_CHARS)
      : t;
  };

  const decision: OpADecision = (() => {
    const d = raw.decision;
    if (d === 'insert' || d === 'exact' || d === 'partial' || d === 'lt-only') return d;
    return 'insert'; // tolerant default — caller can re-decide if needed
  })();

  return {
    entityDisplayName: (raw.entityDisplayName ?? '').trim(),
    entityRaw: (raw.entity ?? '').trim(),
    // 2A.10 Bug A fix: trial-3 logs showed Grok occasionally emits
    // `fact` instead of `factText`. Accept both; factText takes
    // precedence when both are present (the documented spec name).
    factText: trimFactText(raw.factText ?? raw.fact),
    decision,
    existingFactId: raw.existingFactId ?? null,
    isContradiction: !!raw.isContradiction,
    mergedFactText:
      raw.mergedFactText && typeof raw.mergedFactText === 'string'
        ? trimFactText(raw.mergedFactText)
        : null,
    importance: normalizeImportance(raw.importance),
    affectImpact: normalizeAffectImpact(raw.affectImpact ?? null),
    keywords: normalizeKeywords(raw.keywords ?? []),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Write-op computation (plan §5.1 step 5)
// ─────────────────────────────────────────────────────────────────────

export type RowInsertOp = {
  kind: 'insert';
  row: Omit<Doc<'knowledgeFact'>, '_id' | '_creationTime'>;
};
export type RowPatchOp = {
  kind: 'patch';
  id: string; // existing row's _id
  patch: Partial<Doc<'knowledgeFact'>>;
};
/** L7 refresh-copy from LT into ST. Plan §5.1 step 5 lt-only. */
export type RowRefreshCopyOp = {
  kind: 'refresh-copy';
  row: Omit<Doc<'knowledgeFact'>, '_id' | '_creationTime'>;
  sourceLtId: string;
};
export type FactWriteOp = RowInsertOp | RowPatchOp | RowRefreshCopyOp;

/** Result of computeFactWriteOp — bundles the write op + whether the
 *  fact should fire an N24 re-fire (insert / exact / partial / refresh
 *  all qualify per plan §5.1 step 6; pre-LLM short-circuit `exact`
 *  also fires). */
export type FactPlanResult = {
  write: FactWriteOp;
  /** affectImpact emitted by the LLM (already normalized) — used by
   *  the mutation for N24 multiplicative scaling. May be null. */
  refireImpact: AffectImpact | null;
};

/**
 * Compute the deterministic row write-op for one fact given (a) the
 * normalized fact emitted by Op A, (b) the resolved entity playerId
 * (or `'__general__'`), (c) the existing row that the LLM's
 * `existingFactId` points at (or null for `insert`), (d) the owner
 * ids + clock.
 *
 * Throws on plan-required-but-missing inputs (e.g. `partial` without
 * `mergedFactText`). The caller treats throws as "skip this fact +
 * warn" so one bad LLM emission doesn't poison the batch.
 */
export function computeFactWriteOp(args: {
  fact: OpAFactNormalized;
  resolvedEntity: '__general__' | string; // playerId or sentinel
  existing: KnowledgeFactView & { _id: string } | null;
  owner: { playerId: string; agentId: string };
  now: number;
  /** For msg-source history. May be undefined for perception events. */
  messageId?: string;
}): FactPlanResult {
  const { fact, resolvedEntity, existing, owner, now, messageId } = args;
  const histEntry =
    messageId !== undefined
      ? { ts: now, src: { kind: 'msg' as const, messageId: messageId as any } }
      : { ts: now, src: { kind: 'perception' as const, event: 'op-a' } };

  switch (fact.decision) {
    case 'insert': {
      if (!fact.factText) {
        throw new Error('Op A: `insert` requires non-empty factText');
      }
      const row: Omit<Doc<'knowledgeFact'>, '_id' | '_creationTime'> = {
        ownerPlayerId: owner.playerId as any,
        ownerAgentId: owner.agentId as any,
        tier: 'ST',
        entity: resolvedEntity as any,
        factText: fact.factText,
        history: [histEntry],
        frequency: 1,
        createdAt: now,
        lastUpdatedAt: now,
        importance: fact.importance,
        affectImpact: affectForRow(fact.affectImpact),
        pinned: fact.isContradiction,
        source: 'op-a',
        sourceFactId: undefined,
        instinctSlotKey: undefined,
        relatedInstinctId: undefined,
        keywords: fact.keywords,
      };
      return { write: { kind: 'insert', row }, refireImpact: fact.affectImpact };
    }

    case 'exact': {
      if (!existing) {
        throw new Error('Op A: `exact` requires an existing row but none provided');
      }
      // Per plan §5.1 step 5 `exact`: freq++; lastUpdatedAt=now;
      // history.append (capped); affectImpact re-applied; importance =
      // max(existing, fact.importance) if fact provided, else unchanged;
      // keywords = mergeKeywords(existing, fact.keywords) if fact
      // provided, else unchanged.
      const nextHistory = capHistory([...((existing as any).history ?? []), histEntry]);

      // 2A.9 fix (R1 Lens-1 I-1 finding): on `exact` re-encounter the
      // ROW's stored affectImpact must re-fire when the LLM omits a
      // fresh one. Pre-fix `refireImpact` was always `fact.affectImpact`
      // — Grok rarely re-asserts affect on an exact match, so re-fires
      // would skip and the NPC's emotion never moved on remembering a
      // known fact ("fact-feels-dead-on-repeat"). The chosen impact is
      // also what gets written into the patch (consistent semantics).
      const existingImpactAsAffect: AffectImpact | null = existing.affectImpact
        ? {
            label: existing.affectImpact.label,
            intensity: existing.affectImpact.intensity,
            confidence: existing.affectImpact.confidence,
            targetEntity: existing.affectImpact.targetEntity ?? null,
          }
        : null;
      const chosenImpact: AffectImpact | null =
        fact.affectImpact ?? existingImpactAsAffect;

      const patch: Partial<Doc<'knowledgeFact'>> = {
        frequency: existing.frequency + 1,
        lastUpdatedAt: now,
        history: nextHistory as any,
        affectImpact: chosenImpact !== null
          ? affectForRow(chosenImpact)
          : (existing.affectImpact as any) ?? undefined,
      };
      // Importance: monotonic rise on re-encounter (N27).
      // Treat "missing from LLM" as "no update" — but the normalizer
      // always returns an integer ≥ MIN, so we use a sentinel
      // distinction: if the raw `importance` was missing entirely the
      // normalizer returned KNOWLEDGE_IMPORTANCE_DEFAULT (=1). To
      // honor "keep existing unchanged" we apply max-rule which is
      // safe either way (existing ≥ 1 → no fall).
      patch.importance = maxImportance(existing.importance, fact.importance);
      if (fact.keywords.length > 0) {
        patch.keywords = mergeKeywords(existing.keywords ?? [], fact.keywords);
      }
      if (fact.isContradiction) patch.pinned = true; // pin sticks on re-fire
      return {
        write: { kind: 'patch', id: existing._id, patch },
        refireImpact: chosenImpact,
      };
    }

    case 'partial': {
      if (!existing) {
        throw new Error('Op A: `partial` requires an existing row but none provided');
      }
      if (!fact.mergedFactText) {
        throw new Error('Op A: `partial` requires mergedFactText emitted by Grok');
      }
      const nextHistory = capHistory([...((existing as any).history ?? []), histEntry]);
      const patch: Partial<Doc<'knowledgeFact'>> = {
        factText: fact.mergedFactText,
        frequency: existing.frequency + 1,
        lastUpdatedAt: now,
        history: nextHistory as any,
        affectImpact: affectForRow(fact.affectImpact),
        importance: maxImportance(existing.importance, fact.importance),
        pinned: existing.pinned || fact.isContradiction,
        keywords: fact.keywords, // Op A emits post-merge keywords inline (N26)
      };
      return {
        write: { kind: 'patch', id: existing._id, patch },
        refireImpact: fact.affectImpact,
      };
    }

    case 'lt-only': {
      if (!existing) {
        throw new Error('Op A: `lt-only` requires the LT row but none provided');
      }
      if (existing.tier !== 'LT') {
        throw new Error(
          `Op A: \`lt-only\` decision points at row tier=${existing.tier}; expected LT`,
        );
      }
      // L7 refresh: insert a NEW ST copy back-pointing at the LT row
      // via sourceFactId (per plan §5.1 step 5 lt-only). The ST copy
      // is op-a-sourced even when the LT original is instinct (N28).
      const row: Omit<Doc<'knowledgeFact'>, '_id' | '_creationTime'> = {
        ownerPlayerId: owner.playerId as any,
        ownerAgentId: owner.agentId as any,
        tier: 'ST',
        entity: resolvedEntity as any,
        factText: existing.factText ?? '', // same prose as LT original
        history: [histEntry],
        frequency: existing.frequency + 1,
        createdAt: now,
        lastUpdatedAt: now,
        importance: maxImportance(existing.importance, fact.importance),
        affectImpact: affectForRow(fact.affectImpact),
        pinned: existing.pinned, // inherit pin state from LT
        source: 'op-a',
        sourceFactId: existing._id as any, // back-pointer for Op B C1 guard
        instinctSlotKey: undefined,
        relatedInstinctId: undefined,
        keywords: fact.keywords.length > 0 ? fact.keywords : (existing.keywords ?? []),
      };
      return {
        write: { kind: 'refresh-copy', row, sourceLtId: existing._id },
        refireImpact: fact.affectImpact,
      };
    }
  }
}

/** History cap at KNOWLEDGE_FACT_HISTORY_CAP — keep most recent N. */
function capHistory<T>(history: T[]): T[] {
  if (history.length <= KNOWLEDGE_FACT_HISTORY_CAP) return history;
  return history.slice(history.length - KNOWLEDGE_FACT_HISTORY_CAP);
}

/**
 * Coerce a normalized AffectImpact (which may have
 * `targetEntity: null` per Op A's parse semantics) into the schema
 * shape (`targetEntity: string | undefined`). The schema uses
 * `v.optional(playerId)` — null is not in the validator domain.
 */
function affectForRow(
  impact: AffectImpact | null,
): Doc<'knowledgeFact'>['affectImpact'] | undefined {
  if (!impact) return undefined;
  return {
    label: impact.label,
    intensity: impact.intensity,
    confidence: impact.confidence,
    targetEntity: impact.targetEntity ?? undefined,
  } as any;
}

// ─────────────────────────────────────────────────────────────────────
// Display-name resolution (pure)
// ─────────────────────────────────────────────────────────────────────

/**
 * Given a display name → playerId map, resolve an LLM-emitted entity
 * reference to either a playerId or the `'__general__'` sentinel.
 *
 * Resolution order:
 *   1. If `displayName` exactly matches a known display name → return playerId.
 *   2. Else if `entityRaw` equals `'__general__'` → return sentinel.
 *   3. Else if `entityRaw` matches a known display name → return playerId.
 *   4. Otherwise → `'__general__'` (Op A's prompt encourages this fallback).
 */
export function resolveEntity(
  displayName: string,
  entityRaw: string,
  nameMap: ReadonlyMap<string, string>,
): '__general__' | string {
  const dn = (displayName ?? '').trim();
  if (dn && nameMap.has(dn)) return nameMap.get(dn)!;
  const er = (entityRaw ?? '').trim();
  if (er === '__general__') return '__general__';
  if (er && nameMap.has(er)) return nameMap.get(er)!;
  return '__general__';
}

// ─────────────────────────────────────────────────────────────────────
// Pre-LLM exact-dup short-circuit (plan §5.1 v3.4 option b)
// ─────────────────────────────────────────────────────────────────────

/**
 * Determine if a candidate fact's text is byte-identical to any
 * existing ST row in the entity's slice — if so, the LLM call can be
 * skipped for this fact and the matching row's frequency bumped
 * directly. Returns the matching row's _id, or null for no hit.
 *
 * Case + whitespace sensitive on the right side: identical-text
 * means identical-text. Trimming applied symmetrically to both
 * sides so trailing-newline drift doesn't defeat the check.
 */
export function findExactDupInST(
  candidateText: string,
  stSlice: ReadonlyArray<KnowledgeFactView & { _id: string }>,
): string | null {
  const c = (candidateText ?? '').trim();
  if (!c) return null;
  for (const row of stSlice) {
    if (row.tier !== 'ST') continue;
    const r = (row.factText ?? '').trim();
    if (r === c) return row._id;
  }
  return null;
}
