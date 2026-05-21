// Memory v3.5 — universal basic-instinct manifest (Memory plan §13).
//
// Content transcribed from `docs/Instinct_Manifest_Research.md` §3
// (15 universal entries). Research §4 (3 persona-overlay rows
// O-LINA-1/-2/-3) is REJECTED-BY-USER-SCOPE per 2026-05-21 decision —
// the basic-instinct floor must be universal to "any 18-year-old
// (girl) reacting to any situation"; character-specific content lives
// in persona.personality / defaultTask, not here.
//
// Each entry becomes a `knowledgeFact` row at seed time via
// `seedBasicInstincts`:
//   tier: 'LT', source: 'instinct', pinned: true, importance: 3,
//   frequency: 1, affectImpact: undefined (N28 — instincts carry no
//   inherent affect; they are procedural defaults, not episodic
//   memories), entity: '__general__'.
//
// `importance: 3` (not 5) per v3.4 render-policy reconcile (Lens 2):
// the importance ladder is episodic-not-procedural; pivotal one-shot
// events still outrank background instincts. The INSTINCT_RENDER_FLOOR
// + lastUpdatedAt-refresh-on-slice-inclusion guarantee that ≥2
// instincts surface in the general block regardless of score.

import { v } from 'convex/values';
import { Doc } from '../_generated/dataModel';
import { mutation, MutationCtx } from '../_generated/server';
import { normalizeKeywords, Keyword } from './knowledgeFacts';
import {
  KNOWLEDGE_IMPORTANCE_DEFAULT,
  KNOWLEDGE_FACT_MAX_CHARS,
} from '../constants';

// Maslow level used for documentation + future Action-plan routing.
// NOT stored on the row — the row's `entity: '__general__'` plus the
// keyword overlap with PRIORITY_SEED_TERMS is what Op E-G uses to
// surface instincts under the matching level (Action plan §4).
export type MaslowLevel =
  | 'physiological'
  | 'safety'
  | 'belonging'
  | 'esteem'
  | 'selfActualization';

/**
 * Hand-authored seed shape for one instinct row. Authoring leaves out
 * fields that `seedBasicInstincts` fills automatically (ownerPlayerId,
 * ownerAgentId, createdAt, lastUpdatedAt, history, source, tier,
 * pinned, frequency, importance, affectImpact, sourceFactId,
 * relatedInstinctId).
 */
export type InstinctSeed = {
  /** Stable manifest identifier — drives seedBasicInstincts idempotency. */
  slotKey: string;
  /** Maslow level for documentation + future routing (not stored). */
  primaryLevel: MaslowLevel;
  /** Display-name-only prose, ≤ KNOWLEDGE_FACT_MAX_CHARS chars. */
  factText: string;
  /** N26 keyword layer — normalized at seed time. */
  keywords: Keyword[];
  /** Entity scope; always `'__general__'` for the universal floor. */
  entity: '__general__';
};

/**
 * The 15 universal basic-instinct entries (research §3).
 * Coverage: 3 physiological / 5 safety / 3 belonging / 2 esteem /
 * 2 self-actualization. All `entity: '__general__'`; all keyword
 * tokens overlap ≥1 entry in PRIORITY_SEED_TERMS[primaryLevel] (Action
 * plan §4) — that overlap is what Op E-G uses to surface them under
 * the matching priority.
 */
export const INSTINCT_MANIFEST: readonly InstinctSeed[] = [
  // ─── Physiological (3) ─────────────────────────────────────────────
  // I-PHY-1 — homeostatic hunger drive (F2: drive-reduction / Maslow 1943).
  {
    slotKey: 'I-PHY-1',
    primaryLevel: 'physiological',
    factText: '饿了就要找吃的，太久不吃东西身体会发软、注意力会涣散。',
    keywords: [
      { keyword: '饥', assocRatio: 0.95 },
      { keyword: '食', assocRatio: 0.85 },
      { keyword: '身体', assocRatio: 0.4 },
    ],
    entity: '__general__',
  },
  // I-PHY-2 — thermoregulation + thirst (F2).
  {
    slotKey: 'I-PHY-2',
    primaryLevel: 'physiological',
    factText: '冷了要找地方避寒、添衣或取暖；渴了要找水，否则身体会越来越不舒服。',
    keywords: [
      { keyword: '冷', assocRatio: 0.9 },
      { keyword: '渴', assocRatio: 0.9 },
      { keyword: '热', assocRatio: 0.6 },
    ],
    entity: '__general__',
  },
  // I-PHY-3 — sleep / fatigue (F2: primary drive).
  {
    slotKey: 'I-PHY-3',
    primaryLevel: 'physiological',
    factText: '极度疲倦时身体会自行慢下来，判断力也会变差；该睡就得睡，硬撑会出事。',
    keywords: [
      { keyword: '累', assocRatio: 0.9 },
      { keyword: '困', assocRatio: 0.9 },
      { keyword: '睡', assocRatio: 0.85 },
    ],
    entity: '__general__',
  },

  // ─── Safety (5) ────────────────────────────────────────────────────
  // I-SAF-1 — prospect-refuge: scan exits & shelterable spots first (F10).
  {
    slotKey: 'I-SAF-1',
    primaryLevel: 'safety',
    factText: '到了陌生地方，本能上先看清出入口、能藏身或退避的位置，再决定走动。',
    keywords: [
      { keyword: '陌生', assocRatio: 0.9 },
      { keyword: '安全', assocRatio: 0.7 },
      { keyword: '警惕', assocRatio: 0.6 },
      { keyword: '逃', assocRatio: 0.5 },
    ],
    entity: '__general__',
  },
  // I-SAF-2 — attachment safe-haven (F3+F4; sex-neutral per §2 verdict).
  // Replaces the user-flagged "rely on lone male" — the wedge that
  // survived audit is "familiarity-not-sex".
  {
    slotKey: 'I-SAF-2',
    primaryLevel: 'safety',
    factText: '心里发慌时，本能会想靠近自己认识或熟悉的人；陌生人再多也不如一个熟人让人安心。',
    keywords: [
      { keyword: '不安', assocRatio: 0.85 },
      { keyword: '信任', assocRatio: 0.7 },
      { keyword: '陌生', assocRatio: 0.6 },
      { keyword: '熟人', assocRatio: 0.8 },
    ],
    entity: '__general__',
  },
  // I-SAF-3 — sex-differentiated wariness toward unfamiliar males
  //           (F6+F7+F8; user-disposed ship-as-universal 2026-05-21).
  {
    slotKey: 'I-SAF-3',
    primaryLevel: 'safety',
    factText: '作为年轻女生，独处时遇到不认识的男性会本能提高警惕；眼神、距离、动作都先留意。',
    keywords: [
      { keyword: '陌生', assocRatio: 0.8 },
      { keyword: '警惕', assocRatio: 0.85 },
      { keyword: '威胁', assocRatio: 0.5 },
      { keyword: '紧张', assocRatio: 0.55 },
    ],
    entity: '__general__',
  },
  // I-SAF-4 — evolved fear module (F9 Öhman & Mineka; prepared-fear).
  {
    slotKey: 'I-SAF-4',
    primaryLevel: 'safety',
    factText: '天黑、视线不清、独处一处时，本能上的不安会比白日更甚，对声响也更敏感。',
    keywords: [
      { keyword: '惧', assocRatio: 0.8 },
      { keyword: '不安', assocRatio: 0.75 },
      { keyword: '警惕', assocRatio: 0.7 },
      { keyword: '险', assocRatio: 0.55 },
    ],
    entity: '__general__',
  },
  // I-SAF-5 — keep an exit (F4 threat module + F10 prospect-refuge in social space).
  {
    slotKey: 'I-SAF-5',
    primaryLevel: 'safety',
    factText: '不熟的人靠得太近、或被堵在没退路的角落时，本能会想拉开距离或换位置。',
    keywords: [
      { keyword: '紧张', assocRatio: 0.8 },
      { keyword: '逃', assocRatio: 0.7 },
      { keyword: '险', assocRatio: 0.5 },
      { keyword: '距离', assocRatio: 0.8 },
    ],
    entity: '__general__',
  },

  // ─── Belonging (3) ─────────────────────────────────────────────────
  // I-BEL-1 — need to belong; prolonged isolation aversive (F11 Baumeister & Leary).
  {
    slotKey: 'I-BEL-1',
    primaryLevel: 'belonging',
    factText: '太长时间没有人愿意和我说话或留意我，心里会渐渐空落、不踏实。',
    keywords: [
      { keyword: '孤独', assocRatio: 0.9 },
      { keyword: '陪伴', assocRatio: 0.7 },
      { keyword: '联系', assocRatio: 0.55 },
    ],
    entity: '__general__',
  },
  // I-BEL-2 — felt understanding generates closeness (F11 + Reis intimacy).
  {
    slotKey: 'I-BEL-2',
    primaryLevel: 'belonging',
    factText: '当一个人真正听懂我说的话、回应得恰当，我会本能地对他多一分亲近。',
    keywords: [
      { keyword: '理解', assocRatio: 0.9 },
      { keyword: '亲近', assocRatio: 0.85 },
      { keyword: '温暖', assocRatio: 0.5 },
    ],
    entity: '__general__',
  },
  // I-BEL-3 — ostracism detected fast and hurts (F12 Williams).
  {
    slotKey: 'I-BEL-3',
    primaryLevel: 'belonging',
    factText: '在场的人有说有笑却唯独不理我，哪怕时间不长，心里也会很快不是滋味。',
    keywords: [
      { keyword: '孤独', assocRatio: 0.8 },
      { keyword: '认同', assocRatio: 0.6 },
      { keyword: '关心', assocRatio: 0.5 },
    ],
    entity: '__general__',
  },

  // ─── Esteem (2) ────────────────────────────────────────────────────
  // I-EST-1 — sociometer (F13 Leary; F14 face-culture component).
  {
    slotKey: 'I-EST-1',
    primaryLevel: 'esteem',
    factText: '当众被人贬低或嘲笑，本能上会想反驳、回避或离开现场，不愿就这样被定下来。',
    keywords: [
      { keyword: '羞愧', assocRatio: 0.8 },
      { keyword: '自尊', assocRatio: 0.85 },
      { keyword: '面子', assocRatio: 0.7 },
      { keyword: '评价', assocRatio: 0.55 },
    ],
    entity: '__general__',
  },
  // I-EST-2 — competence-recognition rewarding (F15 SDT competence; F13 positive).
  {
    slotKey: 'I-EST-2',
    primaryLevel: 'esteem',
    factText: '被人合理地认可、看见我做得到的事，会让我愿意多付出一点，也会更自在。',
    keywords: [
      { keyword: '被认可', assocRatio: 0.9 },
      { keyword: '被看见', assocRatio: 0.8 },
      { keyword: '能力', assocRatio: 0.7 },
      { keyword: '尊重', assocRatio: 0.6 },
    ],
    entity: '__general__',
  },

  // ─── Self-actualization (2) ────────────────────────────────────────
  // I-SA-1 — curiosity / exploration (F16 Loewenstein info-gap; F15 SDT autonomy).
  {
    slotKey: 'I-SA-1',
    primaryLevel: 'selfActualization',
    factText: '没见过的事物、想不通的情形会牵着我去看一看、问一问，弄明白本身就让我心里舒服。',
    keywords: [
      { keyword: '探索', assocRatio: 0.9 },
      { keyword: '兴趣', assocRatio: 0.75 },
      { keyword: '意义', assocRatio: 0.5 },
    ],
    entity: '__general__',
  },
  // I-SA-2 — meaning-seeking (F16 Steger meaning-in-life).
  {
    slotKey: 'I-SA-2',
    primaryLevel: 'selfActualization',
    factText: '若一件事我自己都说不出意义在哪里，长此以往会觉得空；做事最好能让我感到有所目的。',
    keywords: [
      { keyword: '意义', assocRatio: 0.9 },
      { keyword: '目标', assocRatio: 0.8 },
      { keyword: '价值', assocRatio: 0.7 },
    ],
    entity: '__general__',
  },
];

// Compile-time check: every entry's factText fits the per-row cap.
// (Mutation enforces this too — defensive belt-and-suspenders.)
for (const seed of INSTINCT_MANIFEST) {
  if (seed.factText.length > KNOWLEDGE_FACT_MAX_CHARS) {
    throw new Error(
      `INSTINCT_MANIFEST: ${seed.slotKey} factText is ${seed.factText.length} chars; cap is ${KNOWLEDGE_FACT_MAX_CHARS}`,
    );
  }
}

// Compile-time uniqueness check on slot keys (seedBasicInstincts uses
// them as the load-bearing idempotency identifier — duplicate keys
// would silently double-insert on first seed, then suppress the dup
// on every subsequent seed). Throw early instead.
{
  const seen = new Set<string>();
  for (const seed of INSTINCT_MANIFEST) {
    if (seen.has(seed.slotKey)) {
      throw new Error(`INSTINCT_MANIFEST: duplicate slotKey ${seed.slotKey}`);
    }
    seen.add(seed.slotKey);
  }
}

// Compile-time scope check: per the 2026-05-21 user-scope decision,
// the seeded manifest is UNIVERSAL ONLY — slot keys must start with
// `I-` (instinct prefix). `O-` (overlay / character-specific) slots
// belong to research §4 which is REJECTED-BY-USER-SCOPE; this guard
// prevents accidental re-introduction.
for (const seed of INSTINCT_MANIFEST) {
  if (!seed.slotKey.startsWith('I-')) {
    throw new Error(
      `INSTINCT_MANIFEST: slotKey ${seed.slotKey} must start with 'I-' (universal-only per user scope decision; 'O-' overlays are out of scope)`,
    );
  }
}

/**
 * Convex-validator shape mirror of `InstinctSeed`. Used by
 * `seedBasicInstincts` arg validation when callers want to override
 * the default manifest (e.g., tests).
 */
export const instinctSeedValidator = v.object({
  slotKey: v.string(),
  primaryLevel: v.union(
    v.literal('physiological'),
    v.literal('safety'),
    v.literal('belonging'),
    v.literal('esteem'),
    v.literal('selfActualization'),
  ),
  factText: v.string(),
  keywords: v.array(v.object({ keyword: v.string(), assocRatio: v.number() })),
  entity: v.literal('__general__'),
});

/**
 * Produce the canonical row-fields payload for a single instinct
 * seed, ready to be passed to `db.insert('knowledgeFact', ...)`.
 *
 * Caller supplies (ownerPlayerId, ownerAgentId, now); this helper
 * assembles the full row (including N26-normalized keywords + the
 * fixed instinct invariants: tier='LT', source='instinct',
 * pinned=true, importance=3, frequency=1, affectImpact=undefined,
 * empty history). Returns a structurally-correct
 * `Doc<'knowledgeFact'>`-shaped object minus the system fields
 * (`_id`, `_creationTime`) which Convex assigns.
 */
export function buildInstinctRow(
  seed: InstinctSeed,
  args: {
    ownerPlayerId: string;
    ownerAgentId: string;
    now: number;
  },
): Omit<Doc<'knowledgeFact'>, '_id' | '_creationTime'> {
  // Use KNOWLEDGE_IMPORTANCE_DEFAULT as a defensive reference; the
  // actual instinct importance is fixed at 3 per v3.4 reconcile, but
  // we reference the const so a future tuning move stays linked.
  void KNOWLEDGE_IMPORTANCE_DEFAULT;
  return {
    ownerPlayerId: args.ownerPlayerId as any,
    ownerAgentId: args.ownerAgentId as any,
    tier: 'LT',
    entity: seed.entity,
    factText: seed.factText,
    history: [],
    frequency: 1,
    createdAt: args.now,
    lastUpdatedAt: args.now,
    importance: 3, // v3.4 render-policy reconcile (was 5 in research draft)
    affectImpact: undefined, // N28 — instincts carry no inherent affect
    pinned: true, // N22 + N28 — immune to compaction
    source: 'instinct',
    sourceFactId: undefined,
    instinctSlotKey: seed.slotKey,
    relatedInstinctId: undefined,
    keywords: normalizeKeywords(seed.keywords),
  };
}

/**
 * Filter the manifest to a subset of Maslow levels (for ablation
 * trials — Action plan revival will likely want this).
 * Returns the full manifest when `levels` is `'all'` or `undefined`.
 */
export function filterManifestByLevels(
  manifest: readonly InstinctSeed[],
  levels: 'all' | readonly MaslowLevel[] | undefined,
): InstinctSeed[] {
  if (!levels || levels === 'all') return manifest.slice();
  const set = new Set(levels);
  return manifest.filter((s) => set.has(s.primaryLevel));
}

// ─────────────────────────────────────────────────────────────────────
// seedBasicInstincts (Memory plan §8 phase 2A.2)
// ─────────────────────────────────────────────────────────────────────

/**
 * Per-owner seed: insert any manifest entries whose `slotKey` is not
 * already present as an `instinct`-source LT row owned by this NPC.
 * Idempotent: re-running inserts nothing once all slot keys exist.
 *
 * Repurposes the `owner_tier_source` index from diagnostic-only to
 * load-bearing per Memory plan v3.4 C5.
 *
 * Returns the counts so callers can log / verify; throws nothing
 * (best-effort: a single slot's insert failure shouldn't block the
 * rest of the manifest).
 */
export async function seedBasicInstinctsForOwner(
  ctx: MutationCtx,
  args: {
    ownerPlayerId: string;
    ownerAgentId: string;
    manifest?: readonly InstinctSeed[];
    levels?: 'all' | readonly MaslowLevel[];
    now?: number;
  },
): Promise<{ inserted: number; alreadyPresent: number; consideredFromManifest: number }> {
  const manifest = filterManifestByLevels(
    args.manifest ?? INSTINCT_MANIFEST,
    args.levels,
  );
  const now = args.now ?? Date.now();

  // Existing instinct slot-keys for this owner (load-bearing use of
  // owner_tier_source per C5).
  const existing = await ctx.db
    .query('knowledgeFact')
    .withIndex('owner_tier_source', (q) =>
      q.eq('ownerPlayerId', args.ownerPlayerId as any).eq('tier', 'LT').eq('source', 'instinct'),
    )
    .collect();
  const existingKeys = new Set<string>();
  for (const row of existing) {
    if (row.instinctSlotKey) existingKeys.add(row.instinctSlotKey);
  }

  let inserted = 0;
  let alreadyPresent = 0;
  for (const seed of manifest) {
    if (existingKeys.has(seed.slotKey)) {
      alreadyPresent++;
      continue;
    }
    const row = buildInstinctRow(seed, {
      ownerPlayerId: args.ownerPlayerId,
      ownerAgentId: args.ownerAgentId,
      now,
    });
    await ctx.db.insert('knowledgeFact', row as any);
    inserted++;
  }

  return {
    inserted,
    alreadyPresent,
    consideredFromManifest: manifest.length,
  };
}

/**
 * Public dev seed — operator runs once after the engine has spawned
 * agents (creator inputs are async, so this may need a re-run if
 * agents haven't materialized yet). Iterates the default world's
 * `agents[]` array, seeds the manifest for each owner.
 *
 * Idempotent across runs (per-owner `owner_tier_source` check).
 * Tolerant of pre-agent timing: returns `{ owners: [] }` if the
 * world has no agents yet, with no error.
 *
 *   npx convex run agent/instincts:seedBasicInstincts
 *   npx convex run agent/instincts:seedBasicInstincts '{"levels":["safety","physiological"]}'
 */
export const seedBasicInstincts = mutation({
  args: {
    levels: v.optional(
      v.array(
        v.union(
          v.literal('physiological'),
          v.literal('safety'),
          v.literal('belonging'),
          v.literal('esteem'),
          v.literal('selfActualization'),
        ),
      ),
    ),
  },
  handler: async (ctx, args) => {
    // Find the default world.
    const worldStatus = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!worldStatus) {
      return { owners: [], message: 'no default world found' };
    }
    const world = await ctx.db.get(worldStatus.worldId);
    if (!world) {
      return { owners: [], message: 'world doc missing' };
    }
    if (!world.agents || world.agents.length === 0) {
      return {
        owners: [],
        message: 'no agents spawned yet — re-run after engine processes createAgent inputs',
      };
    }

    const now = Date.now();
    const owners: Array<{
      playerId: string;
      agentId: string;
      inserted: number;
      alreadyPresent: number;
    }> = [];
    for (const agent of world.agents) {
      const result = await seedBasicInstinctsForOwner(ctx, {
        ownerPlayerId: agent.playerId,
        ownerAgentId: agent.id,
        levels: args.levels,
        now,
      });
      owners.push({
        playerId: agent.playerId,
        agentId: agent.id,
        inserted: result.inserted,
        alreadyPresent: result.alreadyPresent,
      });
    }
    return {
      owners,
      manifestSize: filterManifestByLevels(INSTINCT_MANIFEST, args.levels).length,
    };
  },
});
