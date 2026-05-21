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

// RuntimeMindState (Phase 3D). One doc per (owner NPC, target). For the
// single-NPC/single-PC iteration owner-level fields (emotion/situation/
// task/surroundings/globalReflection) live alongside the per-target
// fields; multi-target consolidation is deferred (§7).
export const mindStateFields = {
  ownerPlayerId: playerId, // the NPC ("mind" owner)
  ownerAgentId: agentId,
  targetPlayerId: playerId, // the talkee (the PC)
  // §5.4 owner emotion (decays to 平静/0).
  emotion: v.optional(affectValidator),
  // §5.1-5.3 working memory.
  situation: v.optional(v.string()),
  task: v.optional(v.string()),
  surroundings: v.optional(v.string()),
  // §5.0 cross-person fold (S4 — built, gated to no-op for one pair).
  globalReflection: v.optional(v.string()),
  // §5.5 per-target state.
  affection: v.optional(affectValidator), // §5.5.1 (baseline 0, S3)
  reflectionSummary: v.optional(v.string()), // §5.5.2 (durable fold)
  impressionDelta: v.optional(v.string()), // §4 overlay, relocated to §5.5 (S6)
};

// P1-1D: `memoryFields` / `memoryTables` (memories + memoryEmbeddings)
// were the legacy embedding-based memory path. They are REMOVED — the
// new durable layered-memory store is `mindState` (below in agentTables).
// No table reference remains in the codebase; orphan-data risk was
// validated (all three legacy tables were empty pre-1D).

export const agentTables = {
  // P1-1D: `memoryTables` (memories + memoryEmbeddings) and
  // `embeddingsCache` removed with the embeddings teardown.
  persona: defineTable(personaFields).index('bioName', ['bioName']),
  playerPersona: defineTable(playerPersonaFields).index('playerId', ['playerId']),
  mindState: defineTable(mindStateFields).index('owner_target', [
    'ownerPlayerId',
    'targetPlayerId',
  ]),
};
