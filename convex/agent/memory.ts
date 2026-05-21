// Human-memory port (HumanMemory_AITown_Plan v3.1) — P1-1D.
// `rememberConversation` is the agent's post-conversation hook, called
// from `agentRememberConversation` (convex/aiTown/agentOperations.ts).
// The legacy embedding-based body (summary + importance + fetchEmbedding
// + memoryEmbeddings vectorSearch + reflectOnMemories) is REPLACED with
// the 4-slot reflection-consolidation op per N4-N8. The
// embedding/vector/cache path is fully deleted (1D.C).

import { v } from 'convex/values';
import { ActionCtx, internalMutation, internalQuery } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { chatCompletion } from '../util/llm';
import { GameId, agentId, conversationId, playerId } from '../aiTown/ids';
import { SerializedPlayer } from '../aiTown/player';
import { affectValidator } from './schema';
import {
  EMOTION_HALFLIFE_MS,
  AFFECTION_HALFLIFE_MS,
  REFLECT_MAX_TOKENS,
  REFLECT_TEMPERATURE,
} from '../constants';
import {
  SLOT_IMPRESSION,
  SLOT_EMOTION,
  SLOT_AFFECTION,
  SLOT_CONTRADICTION,
  buildReflectSystemPrompt,
  buildReflectUserBody,
  buildGlobalReflectSystemPrompt,
  buildGlobalReflectUserBody,
  clampGlobalReflection,
  extractSlot,
  parseEmotion,
  parseAffectionDelta,
  hasContradiction,
  isTrivial,
  appendImpressionDelta,
  buildRawBody,
} from './reflection';

const selfInternal = internal.agent.memory;

// ──────────────────────────────────────────────────────────────────
// rememberConversation — 4-slot re-fold-from-raw reflection
// consolidation (N4). Called at conversation end via
// agentRememberConversation. Best-effort: Grok failure → log + bail
// without touching mindState (N4 / S4 best-effort discipline).
// ──────────────────────────────────────────────────────────────────
export async function rememberConversation(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  agentIdArg: GameId<'agents'>,
  playerIdArg: GameId<'players'>,
  conversationIdArg: GameId<'conversations'>,
) {
  const data = await ctx.runQuery(selfInternal.loadReflectionData, {
    worldId,
    agentId: agentIdArg,
    playerId: playerIdArg,
    conversationId: conversationIdArg,
  });
  if (!data) return; // unable to resolve participants — nothing to do.

  // N4: build raw body (oldest-first; N13 display-name speakers).
  const rawConcat = buildRawBody(data.messages);
  if (!rawConcat) return; // empty conversation; nothing to fold.

  const systemPrompt = buildReflectSystemPrompt();
  const userBody = buildReflectUserBody({
    ownerName: data.ownerName,
    ownerPersonality: data.ownerPersonality,
    otherName: data.otherName,
    rawConcat,
  });

  let raw: string;
  try {
    const { content } = await chatCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userBody },
      ],
      max_tokens: REFLECT_MAX_TOKENS,
      temperature: REFLECT_TEMPERATURE,
      stop: ['User:', 'Assistant:'],
    });
    raw = content;
  } catch (e) {
    console.warn(
      `[Reflect] grok failed for owner=${data.ownerPlayerId} other=${data.targetPlayerId}: ${e}`,
    );
    return; // best-effort: leave mindState intact for retry.
  }

  const text = (raw ?? '').trim();
  if (!text) {
    console.warn(
      `[Reflect] empty response for owner=${data.ownerPlayerId} other=${data.targetPlayerId}`,
    );
    return;
  }

  // N5: parse 4 slots. Aborting on missing 往来印象 prevents partial writes.
  const summary = extractSlot(text, SLOT_IMPRESSION);
  if (!summary) {
    const head = text.length > 80 ? text.slice(0, 80) : text;
    console.warn(
      `[Reflect] 往来印象 slot missing owner=${data.ownerPlayerId} other=${data.targetPlayerId}; raw="${head}"`,
    );
    return;
  }
  const emo = parseEmotion(extractSlot(text, SLOT_EMOTION));
  const affDelta = parseAffectionDelta(extractSlot(text, SLOT_AFFECTION));
  const contradiction = hasContradiction(extractSlot(text, SLOT_CONTRADICTION));

  // N6 salience gate.
  const trivial = isTrivial(affDelta, emo.isNeutral);
  const now = Date.now();

  // Always: write summary + ImpressionDelta overlay (S6, cap 3/600).
  const newImpressionDelta = appendImpressionDelta(data.existingImpressionDelta, summary, now);

  // N8: affect application — only when !trivial. Emotion overwrites
  // (Baseline=0, halfLife=EMOTION_HALFLIFE_MS). Affection updates
  // value (clamp [-1,1]) + LastSetMs; preserves Baseline + HalfLifeMs;
  // optional standing-Label write conditional on non-blank/non-neutral.
  let newEmotion: Doc<'mindState'>['emotion'] | undefined = undefined;
  let newAffection: Doc<'mindState'>['affection'] | undefined = undefined;
  if (!trivial) {
    newEmotion = {
      label: emo.label,
      value: emo.intensity,
      baseline: 0,
      halfLifeMs: EMOTION_HALFLIFE_MS,
      lastSetMs: now,
    };
    const prev = data.existingAffection;
    const prevValue = prev?.value ?? 0;
    const prevBaseline = prev?.baseline ?? 0; // S3: no canon → 0
    const prevHalfLife = prev?.halfLifeMs ?? AFFECTION_HALFLIFE_MS;
    const nextValue = Math.max(-1, Math.min(1, prevValue + affDelta));
    // N8 standing-label write: ONLY when emotionLabel non-blank AND !neutral.
    const labelNonBlank = !!emo.label && !!emo.label.trim();
    const nextLabel = labelNonBlank && !emo.isNeutral ? emo.label : prev?.label ?? '';
    newAffection = {
      label: nextLabel,
      value: nextValue,
      baseline: prevBaseline,
      halfLifeMs: prevHalfLife,
      lastSetMs: now,
    };
  }

  // S5 tripwire (no gameplay effect; log-only).
  if (contradiction) {
    console.warn(
      `[Reflect] persona/sense contradiction owner=${data.ownerPlayerId} other=${data.targetPlayerId}: ${extractSlot(
        text,
        SLOT_CONTRADICTION,
      )}`,
    );
  }

  // S4 GlobalReflection — fold IF (>=2 non-blank per-pair summaries
  // after THIS update). Single pair → no-op. Best-effort: failure
  // logs + bails without clobbering existing globalReflection.
  let newGlobalReflection: string | undefined = undefined;
  // Build the projected pair set after this update (the just-finished
  // pair's summary replaces the old one).
  const projectedPairs: Array<{ name: string; summary: string }> = [];
  for (const p of data.allPairs) {
    if (p.targetPlayerId === data.targetPlayerId) {
      projectedPairs.push({ name: p.targetName, summary });
    } else if (p.reflectionSummary && p.reflectionSummary.trim()) {
      projectedPairs.push({ name: p.targetName, summary: p.reflectionSummary });
    }
  }
  if (projectedPairs.length >= 2) {
    try {
      const gSys = buildGlobalReflectSystemPrompt();
      const gUser = buildGlobalReflectUserBody({
        ownerName: data.ownerName,
        pairs: projectedPairs,
      });
      const { content: gRaw } = await chatCompletion({
        messages: [
          { role: 'system', content: gSys },
          { role: 'user', content: gUser },
        ],
        max_tokens: REFLECT_MAX_TOKENS,
        temperature: REFLECT_TEMPERATURE,
        stop: ['User:', 'Assistant:'],
      });
      const clamped = clampGlobalReflection(gRaw);
      if (clamped) newGlobalReflection = clamped;
    } catch (e) {
      console.warn(
        `[Reflect-Global] grok failed for owner=${data.ownerPlayerId}: ${e}` +
          ' (S4: leaving existing globalReflection unchanged)',
      );
      // newGlobalReflection stays undefined → mutation does NOT clobber existing.
    }
  }

  await ctx.runMutation(selfInternal.writeMindStateReflection, {
    worldId,
    ownerPlayerId: data.ownerPlayerId,
    ownerAgentId: data.ownerAgentId,
    targetPlayerId: data.targetPlayerId,
    reflectionSummary: summary,
    impressionDelta: newImpressionDelta,
    emotion: newEmotion,
    affection: newAffection,
    globalReflection: newGlobalReflection,
  });

  return summary;
}

// ──────────────────────────────────────────────────────────────────
// loadReflectionData — single internalQuery that gathers everything
// the consolidation op needs: participants (with N13 display names),
// talker §2 personality, all conversation messages, existing mindState
// for this pair (for ImpressionDelta append + previous affection), and
// all-pairs summaries for the S4 globalReflection projection.
// ──────────────────────────────────────────────────────────────────
export const loadReflectionData = internalQuery({
  args: {
    worldId: v.id('worlds'),
    agentId,
    playerId,
    conversationId,
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) return null;

    // Owner (NPC) playerDescription → bioName / persona-resolution key.
    const ownerDesc = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();
    if (!ownerDesc) return null;

    // Other party: resolved via participatedTogether (jynew's loadConversation pattern).
    const edge = await ctx.db
      .query('participatedTogether')
      .withIndex('conversation', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('player1', args.playerId)
          .eq('conversationId', args.conversationId),
      )
      .first();
    if (!edge) return null;
    const targetPlayerId = edge.player2;

    // Target playerDescription (fallback for name when no playerPersona).
    const targetDesc = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', targetPlayerId))
      .first();

    // §2 source: talker's persona by bioName (= ownerDesc.name).
    const ownerPersona = await ctx.db
      .query('persona')
      .withIndex('bioName', (q) => q.eq('bioName', ownerDesc.name))
      .first();
    const ownerName = ownerPersona?.bioName ?? ownerDesc.name;
    const ownerPersonality = ownerPersona?.personality ?? '';

    // N13: target display name. If target is an NPC → its persona.bioName;
    // else (PC) → playerPersona.displayName (exact match else default).
    let otherName = '?';
    if (targetDesc) {
      const targetAsNpc = await ctx.db
        .query('persona')
        .withIndex('bioName', (q) => q.eq('bioName', targetDesc.name))
        .first();
      if (targetAsNpc) {
        otherName = targetAsNpc.bioName;
      } else {
        let surface = await ctx.db
          .query('playerPersona')
          .withIndex('playerId', (q) => q.eq('playerId', targetPlayerId))
          .first();
        if (!surface) {
          surface = await ctx.db
            .query('playerPersona')
            .withIndex('playerId', (q) => q.eq('playerId', undefined))
            .first();
        }
        otherName = surface?.displayName ?? targetDesc.name;
      }
    }

    // Conversation messages, oldest-first (per the conversationId index).
    const msgDocs = await ctx.db
      .query('messages')
      .withIndex('conversationId', (q) =>
        q.eq('worldId', args.worldId).eq('conversationId', args.conversationId),
      )
      .collect();
    // Render speakers by display name (N13) — match the in-prompt ring.
    const messages = msgDocs.map((m) => ({
      speaker: m.author === args.playerId ? ownerName : otherName,
      text: m.text,
    }));

    // Existing mindState row for this (owner, target) pair.
    const existing = await ctx.db
      .query('mindState')
      .withIndex('owner_target', (q) =>
        q.eq('ownerPlayerId', args.playerId).eq('targetPlayerId', targetPlayerId),
      )
      .first();

    // All-pairs summaries for this owner (S4 GlobalReflection gate input).
    const allOwnerRows = await ctx.db
      .query('mindState')
      .withIndex('owner_target', (q) => q.eq('ownerPlayerId', args.playerId))
      .collect();
    const allPairs = await Promise.all(
      allOwnerRows.map(async (row) => {
        // Resolve the target's display name (same precedence as above).
        const td = await ctx.db
          .query('playerDescriptions')
          .withIndex('worldId', (q) =>
            q.eq('worldId', args.worldId).eq('playerId', row.targetPlayerId),
          )
          .first();
        let name = td?.name ?? row.targetPlayerId;
        if (td) {
          const npc = await ctx.db
            .query('persona')
            .withIndex('bioName', (q) => q.eq('bioName', td.name))
            .first();
          if (npc) {
            name = npc.bioName;
          } else {
            let surface = await ctx.db
              .query('playerPersona')
              .withIndex('playerId', (q) => q.eq('playerId', row.targetPlayerId))
              .first();
            if (!surface) {
              surface = await ctx.db
                .query('playerPersona')
                .withIndex('playerId', (q) => q.eq('playerId', undefined))
                .first();
            }
            name = surface?.displayName ?? td.name;
          }
        }
        return {
          targetPlayerId: row.targetPlayerId,
          targetName: name,
          reflectionSummary: row.reflectionSummary ?? '',
        };
      }),
    );

    return {
      ownerPlayerId: args.playerId,
      ownerAgentId: args.agentId,
      ownerName,
      ownerPersonality,
      targetPlayerId,
      otherName,
      messages,
      existingImpressionDelta: existing?.impressionDelta ?? '',
      existingAffection: existing?.affection ?? null,
      allPairs,
    };
  },
});

// ──────────────────────────────────────────────────────────────────
// writeMindStateReflection — upserts the (owner, target) row with the
// post-consolidation state. Only writes fields that were computed;
// preserves untouched fields (N8 do-not-overwrite discipline for
// Affect.Baseline/HalfLifeMs handled in the action). Undefined fields
// for emotion/affection/globalReflection mean "trivial / single-pair
// / bail" — patch leaves the existing value intact (S4 no-clobber).
// ──────────────────────────────────────────────────────────────────
export const writeMindStateReflection = internalMutation({
  args: {
    worldId: v.id('worlds'),
    ownerPlayerId: playerId,
    ownerAgentId: agentId,
    targetPlayerId: playerId,
    reflectionSummary: v.string(),
    impressionDelta: v.string(),
    emotion: v.optional(affectValidator),
    affection: v.optional(affectValidator),
    globalReflection: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('mindState')
      .withIndex('owner_target', (q) =>
        q.eq('ownerPlayerId', args.ownerPlayerId).eq('targetPlayerId', args.targetPlayerId),
      )
      .first();

    if (!existing) {
      // First-ever consolidation for this pair — insert.
      await ctx.db.insert('mindState', {
        ownerPlayerId: args.ownerPlayerId,
        ownerAgentId: args.ownerAgentId,
        targetPlayerId: args.targetPlayerId,
        reflectionSummary: args.reflectionSummary,
        impressionDelta: args.impressionDelta,
        emotion: args.emotion,
        affection: args.affection,
        globalReflection: args.globalReflection,
      });
      return;
    }

    // Patch — only set what we computed. Leaves untouched fields intact.
    const patch: Partial<Doc<'mindState'>> = {
      reflectionSummary: args.reflectionSummary,
      impressionDelta: args.impressionDelta,
    };
    if (args.emotion !== undefined) patch.emotion = args.emotion;
    if (args.affection !== undefined) patch.affection = args.affection;
    if (args.globalReflection !== undefined) patch.globalReflection = args.globalReflection;
    await ctx.db.patch(existing._id, patch);
  },
});

// Backwards-compat re-export of SerializedPlayer (kept for any external import).
export type { SerializedPlayer };
