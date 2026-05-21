// Human-memory port (HumanMemory_AITown_Plan v2) — P0.3.
// Persona seed + accessors. Replaces the deleted jynew lore pipeline /
// bios.json. Content is USER-SUPPLIED (L2); this file only structures it
// into the §6 schema slots.
//
// Provenance of the content below:
//   Initial seed (user message, 2026-05-19):
//     NPC 琳娜: name, age, appearance, manner, situation — verbatim user input.
//     PC  李平: display name — verbatim user input.
//   C002 dictation (user message, 2026-05-20; variant (b) gate-picked):
//     NPC 琳娜: §5.1 situation, §5.2 task — verbatim user input.
//     PC  李平: §3 appearance + §3 surfaceManner — verbatim user input.
//   FIELDS DERIVED (not user-stated; strict paraphrase, NOT invented traits) —
//   still flagged for user confirmation:
//     - 琳娜.personality (§2): structured from "温文尔雅 / 受过良好的教育 /
//       刚毕业 / 不知如何来到山谷".
//   Edit the records below to correct; re-run `seedHumanMemory`.

import { v } from 'convex/values';
import { mutation, internalQuery } from '../_generated/server';
import { playerId } from '../aiTown/ids';

// The single NPC's bioName MUST match data/characters.ts Descriptions[0].name
// (P0.4) — persona is resolved by the talker's playerDescription.name.
export const LINA_BIONAME = '琳娜';

const LINA_PERSONA = {
  bioName: LINA_BIONAME,
  sex: '女',
  ageText: '18岁',
  // §2 self — TALKER-ONLY (never rendered in any PC-view/§3 artifact, N9/§6).
  personality:
    '琳娜是一个温文尔雅、彬彬有礼的十八岁女生，受过良好的教育，谈吐得体而有分寸。' +
    '她刚参加完高中毕业典礼，却莫名其妙地出现在一个陌生的山谷里，心里其实有些茫然不安，' +
    '但仍努力保持镇定与礼貌，遇事谨慎而不失善意。',
  // §3 first-impression surface — verbatim user input.
  appearance:
    '一头黑色的直发，梳理得非常整齐，头上戴着一个发箍；' +
    '身着蓝白相间的学生水手服，配白色长袜，一双带蝴蝶结的平头粉红色皮鞋。',
  // §3 first-impression demeanor — verbatim user input.
  surfaceManner: '看上去温文尔雅，像是受过良好教育的女生。',
  // §5.1 situation — verbatim user input (C002 dictation, 2026-05-20).
  defaultSituation: '还在参加高中毕业典礼，下一秒就发现自己出现在这个陌生环境里。',
  // §5.2 task — verbatim user input (C002 dictation, 2026-05-20).
  defaultTask: '在保全自身安全的基础上，探索环境，寻找自己出现在这里的原因。',
};

// PC-side surface the NPC perceives (N13). Single default record (one PC).
const LIPING_SURFACE = {
  // No playerId → the default record (matched when no exact-player row).
  displayName: '李平',
  // §3 appearance — verbatim user input (C002 dictation, 2026-05-20, variant b).
  appearance: '长相平平无奇。',
  // §3 manner — verbatim user input (C002 dictation, 2026-05-20).
  surfaceManner: '不自信，躲闪我的目光。但背地里发现他在偷偷的瞄我，有些色色的。',
};

/**
 * Idempotent dev seed. Run any time (persona is resolved by bioName, so
 * it does not depend on agent-creation timing):
 *   npx convex run agent/persona:seedHumanMemory
 * Re-running upserts the records in place — edit the content above and
 * re-run to apply your revised §2 personality / §5.2 task / 李平 manner.
 */
export const seedHumanMemory = mutation({
  args: {},
  handler: async (ctx) => {
    const existingPersona = await ctx.db
      .query('persona')
      .withIndex('bioName', (q) => q.eq('bioName', LINA_PERSONA.bioName))
      .first();
    if (existingPersona) {
      await ctx.db.patch(existingPersona._id, LINA_PERSONA);
    } else {
      await ctx.db.insert('persona', LINA_PERSONA);
    }

    // Default PC surface (playerId undefined).
    const existingDefault = await ctx.db
      .query('playerPersona')
      .withIndex('playerId', (q) => q.eq('playerId', undefined))
      .first();
    if (existingDefault) {
      await ctx.db.patch(existingDefault._id, LIPING_SURFACE);
    } else {
      await ctx.db.insert('playerPersona', LIPING_SURFACE);
    }
    return { persona: LINA_PERSONA.bioName, playerSurface: LIPING_SURFACE.displayName };
  },
});

/** §2/§3 source for the talker NPC, resolved by playerDescription.name. */
export const getPersonaByName = internalQuery({
  args: { bioName: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('persona')
      .withIndex('bioName', (q) => q.eq('bioName', args.bioName))
      .first();
  },
});

/**
 * §3 (PC as talkee) + N13 reflection-header / speaker source. Exact
 * playerId match wins; else the single default record.
 */
export const getPlayerSurface = internalQuery({
  args: { playerId: v.optional(playerId) },
  handler: async (ctx, args) => {
    if (args.playerId) {
      const exact = await ctx.db
        .query('playerPersona')
        .withIndex('playerId', (q) => q.eq('playerId', args.playerId))
        .first();
      if (exact) return exact;
    }
    return await ctx.db
      .query('playerPersona')
      .withIndex('playerId', (q) => q.eq('playerId', undefined))
      .first();
  },
});
