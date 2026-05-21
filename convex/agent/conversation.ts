import { v } from 'convex/values';
import { Id } from '../_generated/dataModel';
import { ActionCtx, internalQuery } from '../_generated/server';
import { LLMMessage, chatCompletion } from '../util/llm';
import { internal } from '../_generated/api';
import { GameId, conversationId, playerId } from '../aiTown/ids';
import { MEMORY_RING_CAP, DIALOG_TEMPERATURE } from '../constants';
import { buildContext, ContextProfile, ShortTerm } from './contextAssembler';
import { ringWindow } from './mindState';
import { buildSurroundings } from './worldContext';

const selfInternal = internal.agent.conversation;

// Human-memory port (P1-1A/1B). The lore-free §2+§3+§5.x spine,
// PREPENDED before the retained legacy memory block (§4A coexistence —
// old path stays until 1D). Empty → contributes nothing (§ omission).
function assemblerBlock(
  profile: ContextProfile,
  talkerPersona: { bioName: string; personality: string } | null | undefined,
  talkeeSurface:
    | { bioName: string; sex: string; ageText: string; appearance: string; surfaceManner: string }
    | null
    | undefined,
  shortTerm: ShortTerm | null | undefined,
): string[] {
  const block = buildContext({
    profile,
    talker: talkerPersona ?? null,
    talkee: talkeeSurface ?? null,
    shortTerm: shortTerm ?? null,
  });
  return block ? [block] : [];
}

export async function startConversationMessage(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  conversationId: GameId<'conversations'>,
  playerId: GameId<'players'>,
  otherPlayerId: GameId<'players'>,
): Promise<string> {
  const {
    player,
    otherPlayer,
    agent,
    otherAgent,
    lastConversation,
    talkerPersona,
    talkeeSurface,
    shortTerm,
  } = await ctx.runQuery(selfInternal.queryPromptData, {
    worldId,
    playerId,
    otherPlayerId,
    conversationId,
  });
  // P1-1D: ContextAssembler is the sole transcript source (§4D /
  // S10). Legacy embedding-search memory block + relatedMemoriesPrompt
  // are deleted; §5.5.2 ReflectionSummary + §5.5.3 derived-window ring
  // inside the assembler provide cross- and in-conversation memory.
  const prompt = [
    `You are ${player.name}, and you just started a conversation with ${otherPlayer.name}.`,
  ];
  prompt.push(...assemblerBlock('full', talkerPersona, talkeeSurface, shortTerm));
  prompt.push(...agentPrompts(otherPlayer, agent, otherAgent ?? null));
  prompt.push(...previousConversationPrompt(otherPlayer, lastConversation));
  // C003 — positive-frame name-permission nudge (no DO-NOT prefix to
  // counter-anchor compliance bias). Start: no brevity/variation rule
  // (no prior turn to repeat).
  prompt.push(...namePermissionNudge(talkeeSurface?.bioName ?? otherPlayer.name));
  const lastPrompt = `${player.name} to ${otherPlayer.name}:`;
  prompt.push(lastPrompt);

  const { content } = await chatCompletion({
    messages: [
      {
        role: 'system',
        content: prompt.join('\n'),
      },
    ],
    max_tokens: 300,
    temperature: DIALOG_TEMPERATURE,
    stop: stopWords(otherPlayer.name, player.name),
  });
  return trimContentPrefx(content, buildPrefixList(player.name, otherPlayer.name));
}

// C003 v2 — strips one of N priority-ordered speaker-tag prefixes from
// the start of model output. Exact `startsWith` match only; never a
// regex / contains. First-match-wins.
//
// IMPORTANT: the prefixes array MUST be ordered longest/most-specific
// FIRST. Patterns later in the array would otherwise short-circuit
// more specific ones (e.g. bare `${name}:` is a prefix of
// `**${name}:**`). Do NOT alphabetize / lint-reorder this array
// without re-verifying ordering. See C003 §"Defect 3 — Fix part 2"
// for the 12-pattern priority list and the reasoning.
export function trimContentPrefx(content: string, prefixes: string[]): string {
  for (const p of prefixes) {
    if (!p) continue;
    if (content.startsWith(p)) {
      return content.slice(p.length).trim();
    }
  }
  return content;
}

// Build the priority-ordered prefix list per call site (12 patterns,
// longest/most-specific first; see CHANGES.md C003 v2 priority list).
function buildPrefixList(playerName: string, otherName: string): string[] {
  const xToY = `${playerName} to ${otherName}:`;
  return [
    `**${xToY}**`, // 1: markdown-wrapped X-to-Y
    xToY, // 2: bare X-to-Y (existing)
    xToY.toLowerCase(), // 3: lowercase X-to-Y (existing)
    `**${playerName}：**`, // 4: markdown + CN colon INSIDE bold
    `**${playerName}:**`, // 5: markdown + EN colon INSIDE bold
    `**${playerName}**：`, // 11: markdown wrap, CN colon OUTSIDE bold (R2 lens-2 R1)
    `**${playerName}**:`, // 12: markdown wrap, EN colon OUTSIDE bold (R2 lens-2 R1)
    `「${playerName}」：`, // 6: CJK quoted + CN colon
    `「${playerName}」:`, // 7: CJK quoted + EN colon
    `${playerName}：`, // 8: bare CN colon
    `${playerName}: `, // 9: bare EN colon + trailing space (BEFORE 10)
    `${playerName}:`, // 10: bare EN colon (must come AFTER 9 — pattern 10 is a strict prefix of pattern 9)
  ];
}

// C003 v2 — soft, register-fitting name-permission nudge. Skipped when
// talkeeName is empty/null to avoid an empty 「」 in the prompt.
function namePermissionNudge(talkeeName: string | undefined): string[] {
  const name = (talkeeName ?? '').trim();
  if (!name) return [];
  return [`你已知道对方的姓名是「${name}」，可以自然地以此称呼对方。`];
}

export async function continueConversationMessage(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  conversationId: GameId<'conversations'>,
  playerId: GameId<'players'>,
  otherPlayerId: GameId<'players'>,
): Promise<string> {
  const {
    player,
    otherPlayer,
    conversation,
    agent,
    otherAgent,
    talkerPersona,
    talkeeSurface,
    shortTerm,
  } = await ctx.runQuery(selfInternal.queryPromptData, {
    worldId,
    playerId,
    otherPlayerId,
    conversationId,
  });
  const now = Date.now();
  const started = new Date(conversation.created);
  // P1-1D: ContextAssembler is sole transcript source — §5.5.3 ring
  // (anchor + last-9) inside the system prompt carries the recent turns
  // for both NPC and player. previousMessages() user-role injection is
  // removed (per plan §4D / S10). Legacy embedding-search block deleted.
  const prompt = [
    `You are ${player.name}, and you're currently in a conversation with ${otherPlayer.name}.`,
    `The conversation started at ${started.toLocaleString()}. It's now ${now.toLocaleString()}.`,
  ];
  prompt.push(...assemblerBlock('full', talkerPersona, talkeeSurface, shortTerm));
  prompt.push(...agentPrompts(otherPlayer, agent, otherAgent ?? null));
  // C003 — instruction stack reordered: positive permission FIRST,
  // then brevity (existing), then positive-frame variation (new).
  // Counter-anchors the model away from compliance-over-conversation
  // bias from the existing 2× "DO NOT" lines.
  prompt.push(...namePermissionNudge(talkeeSurface?.bioName ?? otherPlayer.name));
  prompt.push(
    `Recent conversation turns appear inside the [最近交谈] block of the context above.`,
    `DO NOT greet them again. Do NOT use the word "Hey" too often. Your response should be brief and within 200 characters.`,
    `每一轮请尝试推进对话或换一个角度，不要在同一个想法上原地打转。`,
  );

  const lastPrompt = `${player.name} to ${otherPlayer.name}:`;
  const llmMessages: LLMMessage[] = [
    { role: 'system', content: prompt.join('\n') },
    { role: 'user', content: lastPrompt },
  ];

  const { content } = await chatCompletion({
    messages: llmMessages,
    max_tokens: 300,
    temperature: DIALOG_TEMPERATURE,
    stop: stopWords(otherPlayer.name, player.name),
  });
  return trimContentPrefx(content, buildPrefixList(player.name, otherPlayer.name));
}

export async function leaveConversationMessage(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  conversationId: GameId<'conversations'>,
  playerId: GameId<'players'>,
  otherPlayerId: GameId<'players'>,
): Promise<string> {
  const {
    player,
    otherPlayer,
    conversation,
    agent,
    otherAgent,
    talkerPersona,
    talkeeSurface,
    shortTerm,
  } = await ctx.runQuery(selfInternal.queryPromptData, {
    worldId,
    playerId,
    otherPlayerId,
    conversationId,
  });
  const prompt = [
    `You are ${player.name}, and you're currently in a conversation with ${otherPlayer.name}.`,
    `You've decided to leave the question and would like to politely tell them you're leaving the conversation.`,
  ];
  // P1-1D: lean Leave profile (§2 + §5.4 emotion + §5.5.3 ring only).
  // ContextAssembler is sole transcript source — previousMessages() is
  // removed.
  prompt.push(...assemblerBlock('leave', talkerPersona, talkeeSurface, shortTerm));
  prompt.push(...agentPrompts(otherPlayer, agent, otherAgent ?? null));
  // C003 — name-permission nudge so the parting line can be polite-by-
  // name rather than evasive. Leave has its own closing-instruction
  // (existing) instead of the continue's variation rule (one-shot).
  prompt.push(...namePermissionNudge(talkeeSurface?.bioName ?? otherPlayer.name));
  prompt.push(
    `Recent conversation turns appear inside the [最近交谈] block of the context above.`,
    `How would you like to tell them that you're leaving? Your response should be brief and within 200 characters.`,
  );
  const lastPrompt = `${player.name} to ${otherPlayer.name}:`;
  const llmMessages: LLMMessage[] = [
    { role: 'system', content: prompt.join('\n') },
    { role: 'user', content: lastPrompt },
  ];

  const { content } = await chatCompletion({
    messages: llmMessages,
    max_tokens: 300,
    temperature: DIALOG_TEMPERATURE,
    stop: stopWords(otherPlayer.name, player.name),
  });
  return trimContentPrefx(content, buildPrefixList(player.name, otherPlayer.name));
}

function agentPrompts(
  otherPlayer: { name: string },
  agent: { identity: string; plan: string } | null,
  otherAgent: { identity: string; plan: string } | null,
): string[] {
  const prompt = [];
  if (agent) {
    prompt.push(`About you: ${agent.identity}`);
    prompt.push(`Your goals for the conversation: ${agent.plan}`);
  }
  if (otherAgent) {
    prompt.push(`About ${otherPlayer.name}: ${otherAgent.identity}`);
  }
  return prompt;
}

function previousConversationPrompt(
  otherPlayer: { name: string },
  conversation: { created: number } | null,
): string[] {
  const prompt = [];
  if (conversation) {
    const prev = new Date(conversation.created);
    const now = new Date();
    prompt.push(
      `Last time you chatted with ${
        otherPlayer.name
      } it was ${prev.toLocaleString()}. It's now ${now.toLocaleString()}.`,
    );
  }
  return prompt;
}

// P1-1D: relatedMemoriesPrompt + previousMessages helpers deleted —
// ContextAssembler is sole transcript source (§4D / S10). Recent turns
// are rendered inside the §5.5.3 ring of the assembler's system prompt;
// no separate user-role transcript injection is needed.

export const queryPromptData = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId,
    otherPlayerId: playerId,
    conversationId,
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`World ${args.worldId} not found`);
    }
    const player = world.players.find((p) => p.id === args.playerId);
    if (!player) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    const playerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();
    if (!playerDescription) {
      throw new Error(`Player description for ${args.playerId} not found`);
    }
    const otherPlayer = world.players.find((p) => p.id === args.otherPlayerId);
    if (!otherPlayer) {
      throw new Error(`Player ${args.otherPlayerId} not found`);
    }
    const otherPlayerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.otherPlayerId))
      .first();
    if (!otherPlayerDescription) {
      throw new Error(`Player description for ${args.otherPlayerId} not found`);
    }
    const conversation = world.conversations.find((c) => c.id === args.conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${args.conversationId} not found`);
    }
    const agent = world.agents.find((a) => a.playerId === args.playerId);
    if (!agent) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    const agentDescription = await ctx.db
      .query('agentDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', agent.id))
      .first();
    if (!agentDescription) {
      throw new Error(`Agent description for ${agent.id} not found`);
    }
    const otherAgent = world.agents.find((a) => a.playerId === args.otherPlayerId);
    let otherAgentDescription;
    if (otherAgent) {
      otherAgentDescription = await ctx.db
        .query('agentDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', otherAgent.id))
        .first();
      if (!otherAgentDescription) {
        throw new Error(`Agent description for ${otherAgent.id} not found`);
      }
    }
    const lastTogether = await ctx.db
      .query('participatedTogether')
      .withIndex('edge', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('player1', args.playerId)
          .eq('player2', args.otherPlayerId),
      )
      // Order by conversation end time descending.
      .order('desc')
      .first();

    let lastConversation = null;
    if (lastTogether) {
      lastConversation = await ctx.db
        .query('archivedConversations')
        .withIndex('worldId', (q) =>
          q.eq('worldId', args.worldId).eq('id', lastTogether.conversationId),
        )
        .first();
      if (!lastConversation) {
        throw new Error(`Conversation ${lastTogether.conversationId} not found`);
      }
    }
    // Human-memory port (P1-1A): §2 talker persona-core + §3 talkee
    // first-impression surface. The talker is `player` (the NPC whose
    // turn it is); §2 uses ONLY persona.personality (talker-only, N9/§6).
    const talkerPersonaDoc = await ctx.db
      .query('persona')
      .withIndex('bioName', (q) => q.eq('bioName', playerDescription.name))
      .first();
    const talkerPersona = talkerPersonaDoc
      ? { bioName: talkerPersonaDoc.bioName, personality: talkerPersonaDoc.personality }
      : null;

    // §3 talkee surface. If the talkee is an NPC (deferred multi-NPC),
    // use its persona surface; otherwise (the PC, no agent) use the
    // playerPersona PC-surface descriptor (N13) — exact playerId row
    // wins, else the single default.
    let talkeeSurface: {
      bioName: string;
      sex: string;
      ageText: string;
      appearance: string;
      surfaceManner: string;
    } | null = null;
    if (otherAgent) {
      const op = await ctx.db
        .query('persona')
        .withIndex('bioName', (q) => q.eq('bioName', otherPlayerDescription.name))
        .first();
      if (op) {
        talkeeSurface = {
          bioName: op.bioName,
          sex: op.sex,
          ageText: op.ageText,
          appearance: op.appearance,
          surfaceManner: op.surfaceManner,
        };
      }
    } else {
      let ps = await ctx.db
        .query('playerPersona')
        .withIndex('playerId', (q) => q.eq('playerId', args.otherPlayerId))
        .first();
      if (!ps) {
        ps = await ctx.db
          .query('playerPersona')
          .withIndex('playerId', (q) => q.eq('playerId', undefined))
          .first();
      }
      if (ps) {
        talkeeSurface = {
          bioName: ps.displayName, // N13: canonical PC name, never a raw id
          sex: '',
          ageText: '',
          appearance: ps.appearance,
          surfaceManner: ps.surfaceManner,
        };
      }
    }

    // P1-1B §5.1-5.3 working memory + §5.5.3 derived-window ring.
    // mindState working memory falls back to the persona scene seed
    // (§5.1/§5.2) until reflection writes it. The ring is a READ-ONLY
    // window over the durable `messages` table (S10/N2) — no co-appended
    // write (N3/N11). Speaker = display name, NEVER a raw id (N13).
    const mind = await ctx.db
      .query('mindState')
      .withIndex('owner_target', (q) =>
        q.eq('ownerPlayerId', args.playerId).eq('targetPlayerId', args.otherPlayerId),
      )
      .first();
    const convMessages = await ctx.db
      .query('messages')
      .withIndex('conversationId', (q) =>
        q.eq('worldId', args.worldId).eq('conversationId', args.conversationId),
      )
      .collect();
    const talkeeName = talkeeSurface ? talkeeSurface.bioName : otherPlayerDescription.name;
    const ring = ringWindow(convMessages, MEMORY_RING_CAP).map((m) => ({
      speaker: m.author === player.id ? playerDescription.name : talkeeName,
      text: m.text,
    }));
    // §5.3 surroundings (Fix A): make the NPC aware of the actual map,
    // not just her §5.1 narrative. Ambient = other players in the world
    // besides talker and current talkee (talkee is already in §3).
    const ambientNeighborNames: string[] = [];
    for (const p of world.players) {
      if (p.id === args.playerId || p.id === args.otherPlayerId) continue;
      const pd = await ctx.db
        .query('playerDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', p.id))
        .first();
      if (pd?.name) ambientNeighborNames.push(pd.name);
    }
    const dynamicSurroundings = buildSurroundings({
      position: player.position,
      ambientNeighborNames,
    });
    // S11 (v3.1, post-R3): the dynamic environment + position + ambient
    // is ALWAYS included as the §5.3 base — it does NOT get superseded
    // when 1D later writes `mindState.surroundings`. Instead, the 1D
    // Grok-summarized recent state is APPENDED as an overlay (kept brief
    // by design: 1D should summarize "近况"/recent changes, not
    // re-describe the whole environment). Whitespace-safe: a blank or
    // whitespace-only mind.surroundings contributes nothing. This
    // resolves R3 lens-3 R-1 (the post-1D self-destruct) — Fix A's
    // map-awareness benefit persists permanently.
    const overlay = (mind?.surroundings ?? '').trim();
    const combinedSurroundings = overlay
      ? `${dynamicSurroundings}\n\n【近况（沉淀）】\n${overlay}`
      : dynamicSurroundings;

    const shortTerm: ShortTerm = {
      situation: mind?.situation ?? talkerPersonaDoc?.defaultSituation,
      task: mind?.task ?? talkerPersonaDoc?.defaultTask,
      surroundings: combinedSurroundings,
      ring,
      // P1-1C: affect decayed at read time (N1/N12) in the assembler.
      emotion: mind?.emotion ?? null,
      affection: mind?.affection ?? null,
      reflectionSummary: mind?.reflectionSummary ?? null, // written in 1D
      impressionDelta: mind?.impressionDelta ?? null, // S6 overlay, 1D
      globalReflection: mind?.globalReflection ?? null, // S4, gated in 1D
      talkeeName: talkeeName,
      now: Date.now(),
    };

    return {
      player: { name: playerDescription.name, ...player },
      otherPlayer: { name: otherPlayerDescription.name, ...otherPlayer },
      conversation,
      agent: { identity: agentDescription.identity, plan: agentDescription.plan, ...agent },
      otherAgent: otherAgent && {
        identity: otherAgentDescription!.identity,
        plan: otherAgentDescription!.plan,
        ...otherAgent,
      },
      lastConversation,
      talkerPersona,
      talkeeSurface,
      shortTerm,
    };
  },
});

function stopWords(otherPlayer: string, player: string) {
  // These are the words we ask the LLM to stop on. OpenAI only supports 4.
  const variants = [`${otherPlayer} to ${player}`];
  return variants.flatMap((stop) => [stop + ':', stop.toLowerCase() + ':']);
}
