import { v } from 'convex/values';
import { playerId, agentId } from '../aiTown/ids';
import { defineTable } from 'convex/server';
// P1-1D: EMBEDDING_DIMENSION removed (embeddings teardown). `conversationId`
// validator was only used by the deleted memoryFields data union.

// ─────────────────────────────────────────────────────────────────────
// Human-memory port (HumanMemory_AITown_Plan v2). Lore-free Phase 3D
// state. NOTE: these tables are intentionally NOT added to
// crons.ts TablesToVacuum (R10) — durable disposition decays, never
// deletes (N1/L4).
// ─────────────────────────────────────────────────────────────────────

// jynew `Affect` (RuntimeMindState.cs:48-65) — see convex/agent/affect.ts.
export const affectValidator = v.object({
  label: v.string(),
  value: v.number(),
  baseline: v.number(),
  lastSetMs: v.number(),
  halfLifeMs: v.number(),
});

// §6 Persona — the hand-authored, user-supplied NPC persona-core (L2).
// Replaces the deleted lore pipeline / bios.json. Keyed by bioName
// (unique for the single-NPC iteration; resolved via the talker's
// playerDescription.name — avoids the createAgent agentId-timing issue).
export const personaFields = {
  bioName: v.string(), // §2/§3 header (NPC); lookup key
  sex: v.string(), // §3
  ageText: v.string(), // §3
  personality: v.string(), // §2 self — TALKER-ONLY (N9/§6 boundary)
  appearance: v.string(), // §3 first-impression surface
  surfaceManner: v.string(), // §3 first-impression demeanor
  defaultSituation: v.string(), // §5.1 designer scene seed (non-canon)
  defaultTask: v.string(), // §5.2 designer task seed
};

// §6 PlayerPersona — PC-side surface the NPC perceives (N13). Without
// this, §3 (PC as talkee) is dead and the reflection header / speaker
// attribution degrade to a raw engine id.
export const playerPersonaFields = {
  // Optional: a single default record (one PC this iteration). When set,
  // an exact playerId match wins over the default.
  playerId: v.optional(playerId),
  displayName: v.string(), // N13 — canonical PC name; never a raw id
  appearance: v.string(), // §3 when PC is talkee
  surfaceManner: v.string(), // §3 when PC is talkee
};

// RuntimeMindState. One doc per (owner NPC, target). v3.5 (Tiered
// Knowledge-DB): semantic memory (globalReflection / reflectionSummary /
// impressionDelta) moved to the `knowledgeFact` table below per §3.2.
// What remains is the per-target affect layer (emotion + affection) plus
// the §5.1-5.3 working-memory scalars; everything semantic is in
// knowledgeFact. Multi-target consolidation is deferred (§7).
export const mindStateFields = {
  ownerPlayerId: playerId, // the NPC ("mind" owner)
  ownerAgentId: agentId,
  targetPlayerId: playerId, // the talkee (the PC)
  emotion: v.optional(affectValidator), // KEPT (L10) — §5.4 owner emotion (decays to 平静/0)
  situation: v.optional(v.string()), // KEPT — §5.1 working memory
  task: v.optional(v.string()), // KEPT — §5.2 working memory
  surroundings: v.optional(v.string()), // KEPT — §5.3 working memory
  affection: v.optional(affectValidator), // KEPT (L10) — §5.5.1 per-target (baseline 0, S3)
};

// P1-1D: `memoryFields` / `memoryTables` (memories + memoryEmbeddings)
// were the legacy embedding-based memory path. They are REMOVED — the
// new durable layered-memory store is `knowledgeFact` (v3.5) backed by
// `mindState` for the per-target affect layer (above).
// No table reference remains in the codebase; orphan-data risk was
// validated (all three legacy tables were empty pre-1D).

// ─────────────────────────────────────────────────────────────────────
// §3.1 knowledgeFact — v3.5 tiered (ST/LT) durable fact store, replaces
// v3.2's reflectionSummary / impressionDelta / globalReflection (§3.2).
// Entity is a discriminated union (L3-MF2 / L1-RC5): '__general__' for
// cross-entity facts, playerId for per-entity facts. The sentinel is
// discoverable via the validator.
// ─────────────────────────────────────────────────────────────────────
export const ENTITY_GENERAL = '__general__';
const entityValidator = v.union(v.literal(ENTITY_GENERAL), playerId);

export const knowledgeFactFields = {
  // Owner: the NPC whose memory this is.
  ownerPlayerId: playerId,
  ownerAgentId: agentId,

  // Tier: 'ST' (short-term) | 'LT' (long-term).
  // Same entry can exist in BOTH tiers temporarily under L7 refresh.
  tier: v.union(v.literal('ST'), v.literal('LT')),

  // Entity scope (v2): per-target facts → playerId of the talkee /
  // observed party; general-knowledge facts → ENTITY_GENERAL sentinel.
  entity: entityValidator,

  // Free-text fact prose. N25: MUST contain display names only (Op A
  // sees display names in input and outputs display-name-only prose;
  // outer code translates display-name → playerId before writing
  // `entity`). LLM-merged on exact-match / partial-overlap / refresh.
  // Char budget per fact: KNOWLEDGE_FACT_MAX_CHARS = 200 (mutation-enforced).
  factText: v.string(),

  // Audit trail of source turns / events that contributed (capped to
  // KNOWLEDGE_FACT_HISTORY_CAP = 5; enforced in the mutation, not the
  // validator — L1-RC1).
  history: v.array(
    v.object({
      ts: v.number(),
      src: v.union(
        v.object({ kind: v.literal('msg'), messageId: v.id('messages') }),
        v.object({ kind: v.literal('perception'), event: v.string() }),
      ),
    }),
  ),

  // Counters (N18).
  frequency: v.number(),
  createdAt: v.number(),
  lastUpdatedAt: v.number(),

  // v3.2 (Rec 2 / Park et al 2023 §4.1 retrieval): how memorable /
  // pivotal this fact is, 1..5 integer, LLM-scored by Op A at insertion.
  // Multiplied into §6 render score: importance × frequency × exp(-Δt/τ).
  // On any merge site (Op A partial/refresh, Op B, Op C C1):
  // `max(importance_a, importance_b)` — monotonically rises, never falls.
  importance: v.number(),

  // v2 (N24): memorized affect signature — re-applied to mindState every
  // time this entry is remembered. v3.2 (Rec 6): `confidence: 0..1`
  // gates N24 re-fire via confidence × intensity > N24_REFIRE_THRESHOLD.
  // On merge: take the newer (most-recently-emitted) confidence.
  affectImpact: v.optional(
    v.object({
      label: v.string(),
      intensity: v.number(), // 0..1 for emotion-like; -1..1 for affection-like
      confidence: v.number(), // 0..1 (v3.2 Rec 6) — gates N24 re-fire
      targetEntity: v.optional(playerId), // when this fact's affect is target-specific
    }),
  ),

  // v2 (N22): contradicting entries are pinned (immune to Op C2 delete)
  // and rendered prominently (§6). v3.3 (L23/N28): instinct entries are
  // ALSO pinned (immune to B, C1, C2). Default false; set true by Op A
  // `isContradiction` OR by seedBasicInstincts.
  pinned: v.boolean(),

  // v3.3 (L23/N28): origin. 'op-a' (LLM-extracted, the v3 default) or
  // 'instinct' (pre-seeded by seedBasicInstincts at agent init).
  // Discriminator drives immutability semantics in §5.2/§5.3.
  source: v.union(v.literal('op-a'), v.literal('instinct')),

  // v3.3 (N28): when a row is created via L7 refresh-copy (LT → ST),
  // points back to the LT source row. Op B uses this to detect "this ST
  // row is a refresh-copy of an instinct LT row" and skip merge-into-
  // existing-LT for it. Null for all other rows.
  // v3.4 (C1): when Op B WOULD promote such a refresh-copy to LT, it
  // forces `keep-in-ST` instead (see §5.2).
  sourceFactId: v.optional(v.id('knowledgeFact')),

  // v3.4 (C5) — stable identity for `seedBasicInstincts` idempotency.
  // For source='instinct' rows, this is the manifest-slot identifier
  // (universal-only, e.g. 'I-PHY-1' / 'I-SAF-2' / 'I-BEL-1'). Null
  // for source='op-a'. seedBasicInstincts queries owner_tier_source +
  // compares slot-key set against the manifest to decide which to
  // insert. Slot keys are UNIVERSAL ONLY per the user scope decision
  // recorded in 2026-05-21 review — no character-specific (O-*) slots
  // in the seeded manifest.
  instinctSlotKey: v.optional(v.string()),

  // v3.4 (C8) — diagnostic-only: when Op B's apply-step promotes a
  // non-refresh-copy ST row to LT AND Grok had judged it semantically
  // similar to an existing INSTINCT row (which Op B cannot merge into),
  // this records the related instinct row id. No behavior change.
  relatedInstinctId: v.optional(v.id('knowledgeFact')),

  // v3 (L12 / N26): associative keyword layer. Short Chinese tokens with
  // per-keyword association strength in [0,1]. Generated by Op A;
  // merged on every merge site per N26 deterministic merge contract;
  // bounded by KNOWLEDGE_FACT_MAX_KEYWORDS (8) and 16 chars per keyword
  // (mutation-enforced). Not yet READ by any code path in v3.5.
  keywords: v.array(
    v.object({
      keyword: v.string(),
      assocRatio: v.number(), // [0, 1] — independent per keyword
    }),
  ),
};

export const knowledgeFactTable = {
  knowledgeFact: defineTable(knowledgeFactFields)
    // Primary access patterns:
    .index('owner_tier_entity', ['ownerPlayerId', 'tier', 'entity']) // Op A match query
    .index('owner_tier_freq', ['ownerPlayerId', 'tier', 'frequency']) // Op B/C ranking
    .index('owner_tier_lastUpdated', ['ownerPlayerId', 'tier', 'lastUpdatedAt']) // Op C tiebreak
    .index('owner_tier_pinned', ['ownerPlayerId', 'tier', 'pinned']) // Op C exclusion (v2 N22)
    .index('owner_tier_source', ['ownerPlayerId', 'tier', 'source']), // v3.3 — instinct scan / seedBasicInstincts idempotency
};

export const agentTables = {
  // P1-1D: `memoryTables` (memories + memoryEmbeddings) and
  // `embeddingsCache` removed with the embeddings teardown.
  persona: defineTable(personaFields).index('bioName', ['bioName']),
  playerPersona: defineTable(playerPersonaFields).index('playerId', ['playerId']),
  mindState: defineTable(mindStateFields).index('owner_target', [
    'ownerPlayerId',
    'targetPlayerId',
  ]),
  ...knowledgeFactTable, // v3.5
};
