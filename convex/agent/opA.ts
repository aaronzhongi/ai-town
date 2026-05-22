// Memory v3.5 Op A — per-turn fact extraction + match-tree apply.
//
// Three Convex functions:
//   loadOpAContext  internalQuery     — assembles the Grok prompt's
//                                       inputs (slices + mindState +
//                                       display-name map + persona +
//                                       message text).
//   opAExtract      internalAction    — calls Grok with the assembled
//                                       prompt + dispatches to the
//                                       apply mutation.
//   applyOpAResult  internalMutation  — atomic outer-layer write of
//                                       all fact ops + N24 multiplicative
//                                       affect re-fire + N23 global
//                                       per-turn affect update.
//
// 2A.4 skeleton scope (deferred to later commits):
//   - inProgressOpA / pendingInputs concurrency queue
//   - Auto-firing trigger seams (finishSendingMessage hooks)
//   - lastUpdatedAt refresh on slice-inclusion (plan §5.1 v3.4)
//   - TOCTOU vs Op B (Op B doesn't exist yet)
//   - Op B chained scheduling on ST soft-cap exceed
//
// Manual invocation pattern (this commit's deliverable):
//   npx convex run agent/opA:opAExtract \
//     '{"worldId":"...","ownerPlayerId":"...","ownerAgentId":"...",
//       "otherPlayerId":"...","conversationId":"...","messageId":"..."}'

import { v } from 'convex/values';
import { Doc, Id } from '../_generated/dataModel';
import {
  internalQuery,
  internalAction,
  internalMutation,
  ActionCtx,
} from '../_generated/server';
import { internal } from '../_generated/api';
import { agentId, conversationId, playerId } from '../aiTown/ids';
import { chatCompletion } from '../util/llm';
import {
  AFFECT_DELTA_DEADBAND,
  AFFECTION_HALFLIFE_MS,
  EMOTION_HALFLIFE_MS,
  LT_GENERAL_INSTINCT_BUDGET_CHARS,
  LT_GENERAL_OPA_BUDGET_CHARS,
  OP_A_MAX_TOKENS,
  OP_A_TEMPERATURE,
} from '../constants';
import {
  KnowledgeFactView,
  n24Scale,
  selectGeneralSliceInstincts,
} from './knowledgeFacts';
import {
  computeFactWriteOp,
  normalizeFact,
  OpAFactRaw,
  OpAResponseRaw,
  resolveEntity,
  safeParseOpAResponse,
} from './opAParse';

// ─────────────────────────────────────────────────────────────────────
// loadOpAContext — assemble the inputs the Grok prompt needs.
// ─────────────────────────────────────────────────────────────────────

const PER_ENTITY_SLICE_CHAR_BUDGET = 800;

/** Per-entity char-budget truncation for non-`__general__` slices. */
function truncateSliceByChars<T extends { factText?: string }>(
  rows: readonly T[],
  budget: number,
): T[] {
  const out: T[] = [];
  let used = 0;
  for (const r of rows) {
    const len = (r.factText ?? '').length;
    if (out.length > 0 && used + len > budget) break;
    out.push(r);
    used += len;
    if (used >= budget) break;
  }
  return out;
}

export const loadOpAContext = internalQuery({
  args: {
    worldId: v.id('worlds'),
    ownerPlayerId: playerId,
    ownerAgentId: agentId,
    otherPlayerId: playerId,
    conversationId,
    messageId: v.optional(v.id('messages')),
  },
  handler: async (ctx, args) => {
    // ── Latest message text (the turn we're observing). When
    //    messageId is supplied (PC or NPC turn hook), we fetch it
    //    directly. When omitted (manual invocation), we fall back to
    //    the most recent message in the conversation.
    let lastMessage: Doc<'messages'> | null = null;
    if (args.messageId) {
      lastMessage = await ctx.db.get(args.messageId);
    } else {
      const all = await ctx.db
        .query('messages')
        .withIndex('conversationId', (q) =>
          q.eq('worldId', args.worldId).eq('conversationId', args.conversationId),
        )
        .collect();
      lastMessage = all.length > 0 ? all[all.length - 1] : null;
    }

    // ── Recent message context (last 6 turns; cheap, bounded). The
    //    LLM benefits from seeing the immediate conversational frame
    //    rather than just the single trigger turn.
    const allMessages = await ctx.db
      .query('messages')
      .withIndex('conversationId', (q) =>
        q.eq('worldId', args.worldId).eq('conversationId', args.conversationId),
      )
      .collect();
    const recentMessages = allMessages.slice(Math.max(0, allMessages.length - 6));

    // ── Display-name map (the inverse of the resolution path used in
    //    queryPromptData). Build name → playerId for the world's
    //    players. NPCs resolve via persona.bioName; PCs resolve via
    //    playerPersona.displayName (exact playerId match else default
    //    record).
    //
    // **Critical:** the map is returned as an ARRAY of {name,playerId}
    // pairs rather than a Record<string,string>. Convex's query-return
    // serializer rejects object keys containing non-ASCII characters
    // (e.g., Chinese display names like '李平') — using an object map
    // would crash loadOpAContext on every invocation in this codebase.
    // Consumer (applyOpAResult / opAExtract) rebuilds the Map.
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      return null;
    }
    const nameMapEntries: Array<{ name: string; playerId: string }> = [];
    const playerIdToName: Record<string, string> = {};
    for (const p of world.players) {
      const pd = await ctx.db
        .query('playerDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', p.id))
        .first();
      if (!pd) continue;
      // Try NPC resolution via persona.
      const npcPersona = await ctx.db
        .query('persona')
        .withIndex('bioName', (q) => q.eq('bioName', pd.name))
        .first();
      let displayName: string;
      if (npcPersona) {
        displayName = npcPersona.bioName;
      } else {
        // PC: exact playerId match wins, else default record.
        let surface = await ctx.db
          .query('playerPersona')
          .withIndex('playerId', (q) => q.eq('playerId', p.id))
          .first();
        if (!surface) {
          surface = await ctx.db
            .query('playerPersona')
            .withIndex('playerId', (q) => q.eq('playerId', undefined))
            .first();
        }
        displayName = surface?.displayName ?? pd.name;
      }
      nameMapEntries.push({ name: displayName, playerId: p.id });
      playerIdToName[p.id] = displayName;
    }
    const ownerDisplayName = playerIdToName[args.ownerPlayerId] ?? '?';
    const otherDisplayName = playerIdToName[args.otherPlayerId] ?? '?';

    // ── Owner persona (talker bioName + personality for prompt frame).
    const ownerDesc = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) =>
        q.eq('worldId', args.worldId).eq('playerId', args.ownerPlayerId),
      )
      .first();
    const ownerPersona = ownerDesc
      ? await ctx.db
          .query('persona')
          .withIndex('bioName', (q) => q.eq('bioName', ownerDesc.name))
          .first()
      : null;

    // ── mindState row for this (owner, other) pair.
    const mind = await ctx.db
      .query('mindState')
      .withIndex('owner_target', (q) =>
        q.eq('ownerPlayerId', args.ownerPlayerId).eq('targetPlayerId', args.otherPlayerId),
      )
      .first();

    // ── Per-target slice (ST + LT, entity == other player).
    const [perTargetST, perTargetLT] = await Promise.all([
      ctx.db
        .query('knowledgeFact')
        .withIndex('owner_tier_entity', (q) =>
          q
            .eq('ownerPlayerId', args.ownerPlayerId)
            .eq('tier', 'ST')
            .eq('entity', args.otherPlayerId as any),
        )
        .collect(),
      ctx.db
        .query('knowledgeFact')
        .withIndex('owner_tier_entity', (q) =>
          q
            .eq('ownerPlayerId', args.ownerPlayerId)
            .eq('tier', 'LT')
            .eq('entity', args.otherPlayerId as any),
        )
        .collect(),
    ]);
    const perTargetSliceST = truncateSliceByChars(perTargetST, PER_ENTITY_SLICE_CHAR_BUDGET);
    const perTargetSliceLT = truncateSliceByChars(perTargetLT, PER_ENTITY_SLICE_CHAR_BUDGET);

    // ── General slice (ST + LT, entity == '__general__'). Apply the
    //    two-budget rule per plan §5.1 v3.4 C7: instincts (LT) get
    //    LT_GENERAL_INSTINCT_BUDGET_CHARS via keyword-overlap pre-
    //    filter; op-a (LT) gets LT_GENERAL_OPA_BUDGET_CHARS.
    const [generalST, generalLT] = await Promise.all([
      ctx.db
        .query('knowledgeFact')
        .withIndex('owner_tier_entity', (q) =>
          q
            .eq('ownerPlayerId', args.ownerPlayerId)
            .eq('tier', 'ST')
            .eq('entity', '__general__'),
        )
        .collect(),
      ctx.db
        .query('knowledgeFact')
        .withIndex('owner_tier_entity', (q) =>
          q
            .eq('ownerPlayerId', args.ownerPlayerId)
            .eq('tier', 'LT')
            .eq('entity', '__general__'),
        )
        .collect(),
    ]);
    const generalSliceST = truncateSliceByChars(generalST, PER_ENTITY_SLICE_CHAR_BUDGET);
    // Without pre-extracted input keywords (we don't yet have them
    // since the LLM hasn't seen the turn), the instinct picker falls
    // back to oldest-first ordering with empty overlap. That's the
    // documented best-effort fallback per plan §5.1 v3.4.
    const generalInstinctSlice = selectGeneralSliceInstincts(
      generalLT,
      [],
      LT_GENERAL_INSTINCT_BUDGET_CHARS,
    );
    const generalOpaSlice = truncateSliceByChars(
      generalLT.filter((r) => r.source !== 'instinct'),
      LT_GENERAL_OPA_BUDGET_CHARS,
    );
    const generalSliceLT = [...generalInstinctSlice, ...generalOpaSlice];

    return {
      lastMessage,
      recentMessages,
      ownerDisplayName,
      otherDisplayName,
      ownerPersonality: ownerPersona?.personality ?? '',
      nameMap: nameMapEntries, // array of {name, playerId} pairs — non-ASCII-key safe
      perTargetSliceST,
      perTargetSliceLT,
      generalSliceST,
      generalSliceLT,
      mindState: mind,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────
// applyOpAResult — atomic single-mutation apply of all fact ops +
//                  N24 multiplicative re-fire + global affect.
// ─────────────────────────────────────────────────────────────────────

type ApplyArg = {
  worldId: Id<'worlds'>;
  ownerPlayerId: string;
  ownerAgentId: string;
  otherPlayerId: string;
  messageId?: Id<'messages'>;
  /** Parsed Grok response (post safeParseOpAResponse). */
  response: OpAResponseRaw;
  /** Display-name → playerId entries snapshotted from the query.
   *  Array shape (not Record) to avoid Convex's non-ASCII-field-name
   *  serialization rejection on Chinese display names. */
  nameMap: Array<{ name: string; playerId: string }>;
};

export const applyOpAResult = internalMutation({
  args: {
    worldId: v.id('worlds'),
    ownerPlayerId: playerId,
    ownerAgentId: agentId,
    otherPlayerId: playerId,
    messageId: v.optional(v.id('messages')),
    response: v.any(),
    nameMap: v.any(),
  },
  handler: async (ctx, rawArgs) => {
    const args = rawArgs as ApplyArg;
    const now = Date.now();
    // Rebuild Map from the {name, playerId}[] wire shape (see ApplyArg
    // docstring — the array is used precisely to skip non-ASCII key
    // serialization across the action/mutation boundary).
    const nameMap = new Map<string, string>(
      (args.nameMap ?? []).map((e: { name: string; playerId: string }) => [e.name, e.playerId]),
    );

    // 2A.8 C3 fix: removed the pre-LLM exact-dup short-circuit. The
    // short-circuit (plan §5.1 v3.4 option-b) was a perf optimization
    // but as implemented it silently skipped the per-turn global
    // affect update — repeated inputs (the most common manual test
    // pattern) lost their emotion delta. Correctness > perf for the
    // trial; re-enable later with a fix that preserves global affect.

    let inserted = 0;
    let patched = 0;
    let refreshCopied = 0;
    let n24Refires = 0;
    let n24Skipped = 0;

    // ── Per-fact processing.
    for (const raw of args.response.facts ?? []) {
      try {
        const fact = normalizeFact(raw as OpAFactRaw);
        const resolved = resolveEntity(fact.entityDisplayName, fact.entityRaw, nameMap);
        // Existing row lookup when decision requires it.
        let existing: (KnowledgeFactView & { _id: string }) | null = null;
        if (fact.existingFactId && fact.decision !== 'insert') {
          const row = await ctx.db.get(fact.existingFactId as Id<'knowledgeFact'>);
          if (row) {
            // 2A.9 cross-owner guard (R1 Lens-1 L1-new / R1-C4 finding):
            // Grok could in principle emit a hallucinated existingFactId
            // that resolves to a row owned by a DIFFERENT NPC. Without
            // this check, applyOpAResult would patch that other NPC's
            // memory (silent cross-NPC corruption). Treat as null → the
            // fact gets dropped by computeFactWriteOp's "requires
            // existing" throw, caught by the outer try/catch, warn-log
            // gives the operator a trace.
            if (row.ownerPlayerId !== args.ownerPlayerId) {
              console.warn(
                `[Op A] cross-owner guard: existingFactId ${fact.existingFactId} belongs to owner ${row.ownerPlayerId}, not ${args.ownerPlayerId}; dropping fact`,
              );
            } else if ((row.entity as any) !== resolved) {
              // 2A.9 cross-entity guard (Verification Lens-2 point 4):
              // symmetric to the cross-owner guard. Grok could emit an
              // existingFactId pointing at a row owned by this NPC but
              // SCOPED TO A DIFFERENT entity than the fact's resolved
              // entity. Without this check, the patch would frequency-
              // bump + history-append against the wrong target's memory
              // (e.g. fact about 李平 mis-attached to 张三's slice).
              // Drop the fact + warn rather than corrupt the wrong
              // target's record.
              console.warn(
                `[Op A] cross-entity guard: existingFactId ${fact.existingFactId} scoped to entity ${row.entity}, not ${resolved}; dropping fact`,
              );
            } else {
              existing = row as any;
              // 2A.9 N28 instinct-immutability guard (trial-2 surfaced):
              // Op A trial-2 data showed Grok emitted decision='exact'
              // against an LT instinct row (I-SAF-3), and the apply
              // path patched it — frequency 1→2, lastUpdatedAt
              // advanced, affectImpact ADDED where N28 says it stays
              // null forever. Instincts are canonical/immutable by
              // design (per [[basic-instincts-scope]]). Downgrade any
              // exact/partial decision targeting source='instinct' to
              // 'lt-only', which creates an ST refresh-copy via the
              // L7 path WITHOUT modifying the canonical LT instinct.
              if (
                existing &&
                existing.source === 'instinct' &&
                (fact.decision === 'exact' || fact.decision === 'partial')
              ) {
                console.warn(
                  `[Op A] N28 guard: Grok emitted decision=${fact.decision} against instinct row ${existing._id} (slotKey=${(existing as any).instinctSlotKey ?? '?'}); downgrading to lt-only to preserve instinct immutability`,
                );
                fact.decision = 'lt-only';
                // lt-only also requires factText to come from the LT row
                // (refresh-copy path uses existing.factText). Clear any
                // mergedFactText the LLM emitted for a partial decision
                // so we don't accidentally use it.
                fact.mergedFactText = null;
              }
            }
          }
        }
        const plan = computeFactWriteOp({
          fact,
          resolvedEntity: resolved,
          existing,
          owner: { playerId: args.ownerPlayerId, agentId: args.ownerAgentId },
          now,
          messageId: args.messageId as any,
        });
        // Apply the write.
        if (plan.write.kind === 'insert') {
          await ctx.db.insert('knowledgeFact', plan.write.row as any);
          inserted++;
        } else if (plan.write.kind === 'patch') {
          await ctx.db.patch(plan.write.id as Id<'knowledgeFact'>, plan.write.patch as any);
          patched++;
        } else if (plan.write.kind === 'refresh-copy') {
          await ctx.db.insert('knowledgeFact', plan.write.row as any);
          refreshCopied++;
        }
        // N24 multiplicative re-fire (plan §5.1 step 6). The PERF
        // floor in n24Scale skips negligible-magnitude applies.
        const scaled = n24Scale(plan.refireImpact);
        if (scaled.shouldRefire) {
          // 2A.8 C2 fix: Grok emits display names (per N25/system-prompt
          // discipline), not playerIds. Resolve `impact.targetEntity`
          // through the same nameMap that resolves entity, so the
          // per-target/owner-emotion routing works. Pre-fix, the
          // string-compare display-name === playerId always failed
          // and every refire was routed to owner emotion overwrite,
          // burying per-target affection updates.
          const rawTarget = plan.refireImpact!.targetEntity;
          const resolvedTarget = rawTarget
            ? resolveEntity(rawTarget, '', nameMap)
            : null;
          const routeToPerTarget = resolvedTarget === args.otherPlayerId;
          await applyN24Refire(ctx, {
            worldId: args.worldId,
            ownerPlayerId: args.ownerPlayerId,
            ownerAgentId: args.ownerAgentId,
            targetPlayerId: args.otherPlayerId,
            impact: plan.refireImpact!,
            scaledIntensity: scaled.applied,
            routeToPerTarget,
            now,
          });
          n24Refires++;
        } else if (plan.refireImpact) {
          n24Skipped++;
        }
      } catch (e) {
        console.warn(
          `[Op A apply] skipping fact due to error: ${(e as Error).message}`,
          JSON.stringify(raw)?.slice(0, 200),
        );
        continue;
      }
    }

    // ── Global per-turn affect update (plan §5.1 step 7). Per N23
    //    this fires UNCONDITIONAL of the N24 confidence threshold —
    //    that gate applies to row re-fires only. The deadband
    //    AFFECT_DELTA_DEADBAND guards against noise.
    const affect = args.response.affect;
    if (affect) {
      await applyGlobalAffect(ctx, {
        worldId: args.worldId,
        ownerPlayerId: args.ownerPlayerId,
        ownerAgentId: args.ownerAgentId,
        targetPlayerId: args.otherPlayerId,
        affect,
        now,
      });
    }

    return {
      inserted,
      patched,
      refreshCopied,
      shortCircuited: false,
      n24Refires,
      n24Skipped,
    };
  },
});

/** Apply per-row N24 multiplicative scaling to mindState. The
 *  `scaledIntensity` is `intensity × confidence` (signed; preserves
 *  direction for affection-like signals).
 *
 *  Routing rule: `routeToPerTarget` is set by the caller after
 *  resolving `impact.targetEntity` (a display name from Grok) through
 *  the nameMap. When true → apply to per-target affection. When false
 *  (or no target) → apply to owner emotion (label preserved; halflife
 *  = EMOTION_HALFLIFE_MS). */
async function applyN24Refire(
  ctx: any,
  args: {
    worldId: Id<'worlds'>;
    ownerPlayerId: string;
    ownerAgentId: string;
    targetPlayerId: string;
    impact: { label: string; targetEntity?: string | null; intensity: number; confidence: number };
    scaledIntensity: number;
    routeToPerTarget: boolean;
    now: number;
  },
) {
  const mind = await ctx.db
    .query('mindState')
    .withIndex('owner_target', (q: any) =>
      q.eq('ownerPlayerId', args.ownerPlayerId).eq('targetPlayerId', args.targetPlayerId),
    )
    .first();

  if (args.routeToPerTarget) {
    const prev = mind?.affection;
    const prevValue = prev?.value ?? 0;
    const prevBaseline = prev?.baseline ?? 0;
    const prevHalfLife = prev?.halfLifeMs ?? AFFECTION_HALFLIFE_MS;
    const nextValue = Math.max(-1, Math.min(1, prevValue + args.scaledIntensity));
    const nextAffection = {
      label: prev?.label ?? args.impact.label,
      value: nextValue,
      baseline: prevBaseline,
      halfLifeMs: prevHalfLife,
      lastSetMs: args.now,
    };
    if (mind) {
      await ctx.db.patch(mind._id, { affection: nextAffection });
    } else {
      await ctx.db.insert('mindState', {
        ownerPlayerId: args.ownerPlayerId as any,
        ownerAgentId: args.ownerAgentId as any,
        targetPlayerId: args.targetPlayerId as any,
        affection: nextAffection,
      });
    }
  } else {
    // Owner emotion overwrite (per N23). Magnitude of scaledIntensity
    // is what we apply; sign is direction-of-feeling but emotion is
    // always 0..1 magnitude.
    const newEmotion = {
      label: args.impact.label,
      value: Math.min(1, Math.abs(args.scaledIntensity)),
      baseline: 0,
      halfLifeMs: EMOTION_HALFLIFE_MS,
      lastSetMs: args.now,
    };
    if (mind) {
      await ctx.db.patch(mind._id, { emotion: newEmotion });
    } else {
      await ctx.db.insert('mindState', {
        ownerPlayerId: args.ownerPlayerId as any,
        ownerAgentId: args.ownerAgentId as any,
        targetPlayerId: args.targetPlayerId as any,
        emotion: newEmotion,
      });
    }
  }
}

/** Apply the global per-turn affect block (Op A response.affect) per
 *  plan §5.1 step 7 + N23 application discipline. Emotion overwrites;
 *  affectionDelta clamped to per-target affection with deadband. */
async function applyGlobalAffect(
  ctx: any,
  args: {
    worldId: Id<'worlds'>;
    ownerPlayerId: string;
    ownerAgentId: string;
    targetPlayerId: string;
    affect: NonNullable<OpAResponseRaw['affect']>;
    now: number;
  },
) {
  const mind = await ctx.db
    .query('mindState')
    .withIndex('owner_target', (q: any) =>
      q.eq('ownerPlayerId', args.ownerPlayerId).eq('targetPlayerId', args.targetPlayerId),
    )
    .first();

  const patch: any = {};

  const emo = args.affect.emotion;
  if (emo && emo.label && typeof emo.intensity === 'number') {
    let v = emo.intensity;
    if (!Number.isFinite(v)) v = 0;
    if (v < 0) v = 0;
    if (v > 1) v = 1;
    patch.emotion = {
      label: emo.label,
      value: v,
      baseline: 0,
      halfLifeMs: EMOTION_HALFLIFE_MS,
      lastSetMs: args.now,
    };
  }

  if (typeof args.affect.affectionDelta === 'number') {
    let delta = args.affect.affectionDelta;
    if (!Number.isFinite(delta)) delta = 0;
    if (Math.abs(delta) >= AFFECT_DELTA_DEADBAND) {
      const prev = mind?.affection;
      const prevValue = prev?.value ?? 0;
      const prevBaseline = prev?.baseline ?? 0;
      const prevHalfLife = prev?.halfLifeMs ?? AFFECTION_HALFLIFE_MS;
      const nextValue = Math.max(-1, Math.min(1, prevValue + delta));
      patch.affection = {
        label: prev?.label ?? '',
        value: nextValue,
        baseline: prevBaseline,
        halfLifeMs: prevHalfLife,
        lastSetMs: args.now,
      };
    }
  }

  if (Object.keys(patch).length === 0) return;

  if (mind) {
    await ctx.db.patch(mind._id, patch);
  } else {
    await ctx.db.insert('mindState', {
      ownerPlayerId: args.ownerPlayerId as any,
      ownerAgentId: args.ownerAgentId as any,
      targetPlayerId: args.targetPlayerId as any,
      ...patch,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
// opAExtract — internalAction (LLM call + dispatch)
// ─────────────────────────────────────────────────────────────────────

/** Op A's Chinese system prompt (plan §5.1, expanded per 2A.8 reviewer
 *  C1 fix — Grok now sees row IDs in slice rendering AND is explicitly
 *  taught the existingFactId → row-id mapping for the match-tree). */
const OP_A_SYSTEM_PROMPT =
  '你在做"感知与记忆登记"。下面是这位角色刚获取的新输入（对话/见闻），以及她目前关于相关对象的短期(ST)和长期(LT)记忆切片。' +
  '请抽取若干原子事实，并对每条判定其与已有记忆的关系：insert（新事实，已有切片中找不到任何相关条目）/ exact（与已有某条记忆完全相同，仅需提升频次）/ partial（与已有某条记忆部分重叠，需要合并文本）/ lt-only（仅长期记忆中存在，本次重新提起需刷新到短期）。' +
  '【重要：决策与已有条目的链接方式】每条切片中的记忆条目都以 `[id=xxxxxxx, ST/LT, freq=N, imp=N]` 开头，其中 `xxxxxxx` 是该记忆在系统中的唯一标识。当你做出 exact / partial / lt-only 决策时，必须把对应条目的 `xxxxxxx` 字符串原样填入输出的 `existingFactId` 字段；做出 insert 决策时，`existingFactId` 设为 null。' +
  '对 partial 与 lt-only 决策，请同时给出合并后的整段文本 `mergedFactText`（≤200字符），完整覆盖原文。' +
  '如该事实是对已有记忆的明显否证（如同一人姓名不一致），请把 `isContradiction` 置 true 并在合并文本中保留双方版本。' +
  '同时给出该事实在登记时所唤起的情绪/好恶（写入 `affectImpact`：{label, intensity (-1~1), confidence (0~1), targetEntity (对方的显示姓名或 null)}），把握不大就给低 confidence。' +
  '为每条事实给出 `importance`（1~5整数，5=刻骨铭心 / 4=印象深刻 / 3=值得记得 / 2=普通琐事 / 1=可有可无；一次性的震撼事件可以是5即便频次只有1，反之鸡毛蒜皮即便反复出现也是1）。' +
  '为每条事实给出 2–6 个中文短词关键词（≤16字），每个关键词附带一个 0~1 之间的关联强度数值（独立，非概率分布），表示该事实在以该关键词回想时会被想起的强度。' +
  '对 `partial` / `lt-only` 决策，请直接给出合并后的关键词列表（已在 `mergedFactText` 处做了文本合并；关键词同时合并即可）。' +
  '【全局情绪 affect 字段】最后输出本轮对话整体引起的情绪与好恶变化：{emotion: {label, intensity (0~1)} 或 null, affectionDelta: -1~1 或 0, targetEntity: 对方的显示姓名}。' +
  '【输出格式严格示例】（JSON 键名 ASCII；值中的事实/标签/关键词使用中文；不要加代码块标记或说明文字）：' +
  '{"facts":[{"factText":"李平自我介绍说他叫李平","entity":"__general__","entityDisplayName":"李平","decision":"insert","existingFactId":null,"isContradiction":false,"mergedFactText":null,"importance":3,"affectImpact":{"label":"谨慎好奇","intensity":0.3,"confidence":0.6,"targetEntity":"李平"},"keywords":[{"keyword":"姓名","assocRatio":0.8},{"keyword":"陌生","assocRatio":0.6}]}],"affect":{"emotion":{"label":"谨慎","intensity":0.4},"affectionDelta":0.1,"targetEntity":"李平"}}。' +
  '严格使用上例的键名 `factText`（不是 `fact`）、`existingFactId`、`mergedFactText`、`affectImpact`。仅输出 JSON 本身，无任何说明文字。';

/** Render a knowledgeFact slice into a compact human-readable block for
 *  the Grok prompt. Per 2A.8 C1 fix: emits the row's `_id` so Grok can
 *  reference it as `existingFactId` on `exact`/`partial`/`lt-only`
 *  decisions. Without IDs in the prompt, the entire match-tree is
 *  functionally dead because Grok has nothing to point at. */
function renderSliceForPrompt(
  label: string,
  rows: readonly (KnowledgeFactView & { _id?: string })[],
): string {
  if (!rows.length) return `${label}：（无）`;
  const lines = [`${label}：`];
  for (const r of rows) {
    const id = r._id ?? '?';
    lines.push(
      `  - [id=${id}, ${r.tier}, freq=${r.frequency}, imp=${r.importance}] ${r.factText ?? ''}`,
    );
  }
  return lines.join('\n');
}

export const opAExtract = internalAction({
  args: {
    worldId: v.id('worlds'),
    ownerPlayerId: playerId,
    ownerAgentId: agentId,
    otherPlayerId: playerId,
    conversationId,
    messageId: v.optional(v.id('messages')),
  },
  handler: async (ctx: ActionCtx, args) => {
    const context = await ctx.runQuery(internal.agent.opA.loadOpAContext, args);
    if (!context) {
      console.warn('[Op A] loadOpAContext returned null (world missing); skipping.');
      return { ok: false, reason: 'no-context' as const };
    }
    if (!context.lastMessage || !(context.lastMessage.text ?? '').trim()) {
      return { ok: false, reason: 'no-message' as const };
    }

    // 2A.8 C3 fix: pre-LLM short-circuit removed (see applyOpAResult
    // comment). Repeated-input cases now eat a Grok call; that's
    // acceptable while we don't yet have a way to preserve the global
    // affect update through a short-circuit path. `findExactDupInST`
    // remains exported from opAParse.ts for future re-enablement.

    // Assemble prompt.
    const recent = context.recentMessages
      .map((m: Doc<'messages'>) => {
        const speaker =
          m.author === args.ownerPlayerId
            ? context.ownerDisplayName
            : m.author === args.otherPlayerId
            ? context.otherDisplayName
            : '?';
        return `${speaker}：${m.text}`;
      })
      .join('\n');

    const userBody =
      `【角色】${context.ownerDisplayName}（性情：${context.ownerPersonality || '（无）'}）。` +
      `\n【对话对象】${context.otherDisplayName}\n` +
      `\n【最近对话片段（最新在末尾）】\n${recent}\n` +
      `\n【最新一条】${context.lastMessage.text}\n` +
      `\n${renderSliceForPrompt('关于此人 ST', context.perTargetSliceST)}` +
      `\n${renderSliceForPrompt('关于此人 LT', context.perTargetSliceLT)}` +
      `\n${renderSliceForPrompt('一般记忆 ST', context.generalSliceST)}` +
      `\n${renderSliceForPrompt('一般记忆 LT（含基本本能 + op-a）', context.generalSliceLT)}` +
      `\n\n请输出 JSON：{ "facts": [...], "affect": { ... } }`;

    let content: string;
    try {
      const result = await chatCompletion({
        messages: [
          { role: 'system', content: OP_A_SYSTEM_PROMPT },
          { role: 'user', content: userBody },
        ],
        max_tokens: OP_A_MAX_TOKENS,
        temperature: OP_A_TEMPERATURE,
        stop: ['User:', 'Assistant:'],
      });
      content = result.content;
    } catch (e) {
      console.warn(
        `[Op A] grok call failed for owner=${args.ownerPlayerId} other=${args.otherPlayerId}: ${e}`,
      );
      return { ok: false, reason: 'grok-failed' as const };
    }

    let parsed: OpAResponseRaw;
    try {
      parsed = safeParseOpAResponse(content);
    } catch (e) {
      console.warn(
        `[Op A] parse failed for owner=${args.ownerPlayerId} other=${args.otherPlayerId}: ${e}\n  raw head: ${content.slice(0, 120)}`,
      );
      return { ok: false, reason: 'parse-failed' as const };
    }

    // Explicit `any` annotation breaks the self-referential type-
    // inference cycle: opAExtract → calls applyOpAResult (same module)
    // → return type of applied → tsc tries to resolve opAExtract's
    // own return type. Standard Convex idiom for same-module action
    // → mutation dispatch.
    const applied: any = await ctx.runMutation(
      internal.agent.opA.applyOpAResult,
      {
        worldId: args.worldId,
        ownerPlayerId: args.ownerPlayerId,
        ownerAgentId: args.ownerAgentId,
        otherPlayerId: args.otherPlayerId,
        messageId: args.messageId,
        response: parsed,
        nameMap: context.nameMap,
      },
    );

    return { ok: true as const, applied };
  },
});
