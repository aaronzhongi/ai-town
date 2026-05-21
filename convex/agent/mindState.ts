// Human-memory port (HumanMemory_AITown_Plan v2) — P1-1B.
// The episodic ring is a DERIVED READ-ONLY WINDOW over ai-town's durable
// `messages` table (S10), NOT a co-appended structure. jynew's in-memory
// ring + `[spill]`/`IsFolded`/`Ring.Clear()` are unnecessary no-ops here
// (S10): ai-town's `messages` table is the durable per-conversation
// transcript jynew emulated. This module is PURE (no Convex/IO) so the
// window rule is unit-testable; callers pass messages in creation order.
//
// v3.5: §6 knowledge-fact render (`renderPerTargetKnowledge` +
// `renderGeneralKnowledge`) added below. These consume the
// deterministic sort/score helpers in `knowledgeFacts.ts`.

import {
  MEMORY_RING_CAP,
  EMOTION_FLOOR,
  RENDER_FACTS_PER_TARGET,
  RENDER_FACTS_GENERAL,
} from '../constants';
import { Affect, affectCurrent } from './affect';
import {
  KnowledgeFactView,
  sortPerTargetFacts,
  sortGeneralFacts,
} from './knowledgeFacts';

/**
 * N2 window rule — reproduces jynew `EpisodicRing` anchor + last-(cap-1)
 * EXACTLY (EpisodicRing.cs:84-95):
 *   k ≤ cap            → all
 *   k  > cap           → { items[0] (pinned anchor) } ∪ { last cap-1 }
 * For k=11, cap=10 → [m0, m2..m10] (m0 ∪ m[k-9..k-1]) — identical to
 * jynew's per-append RemoveAt(1) steady state.
 */
export function ringWindow<T>(items: T[], cap: number = MEMORY_RING_CAP): T[] {
  if (cap <= 0) return [];
  if (items.length <= cap) return items.slice();
  const anchor = items[0];
  const tail = items.slice(items.length - (cap - 1)); // last cap-1
  return [anchor, ...tail];
}

export type RingTurn = { speaker: string; text: string };

/**
 * §5.5.3 ring render (ContextAssembler.cs `AppendRing`, extract §4).
 * The LAST line is preceded by the ［刚刚结束的对话］ marker (N12).
 * `speaker` is a display name resolved by the caller (N13) — NEVER a
 * raw engine id. Returns null when the window is empty (§ omission).
 */
export function renderRing(window: RingTurn[]): string | null {
  if (!window.length) return null;
  const lines: string[] = [`最近交谈（最近${window.length}轮）：`];
  const last = window.length - 1;
  for (let i = 0; i < window.length; i++) {
    const t = window[i];
    if (t == null) continue;
    if (i === last) lines.push('［刚刚结束的对话］');
    lines.push(`${t.speaker}：${t.text}`);
  }
  return lines.join('\n');
}

/**
 * §5.1-5.3 working-memory block. Whole block omitted when all fields
 * empty (§ omission). §5.1 carries the plain "designer-set scene" note
 * (no canon claim) per §4A.
 */
export function renderWorkingMemory(wm: {
  situation?: string;
  task?: string;
  surroundings?: string;
}): string | null {
  const sit = (wm.situation ?? '').trim();
  const task = (wm.task ?? '').trim();
  const sur = (wm.surroundings ?? '').trim();
  if (!sit && !task && !sur) return null;
  const lines = ['【此刻情形 — 工作记忆（设计者设定的虚构情境，非小说原文桥段）】'];
  if (sit) lines.push(`情境：${sit}`);
  if (task) lines.push(`任务：${task}`);
  if (sur) lines.push(`周遭：${sur}`);
  return lines.join('\n');
}

/**
 * §5.4 此刻心绪 — decayed at READ time (N1) via affectCurrent; omitted
 * when unset OR Current(now) < EMOTION_FLOOR (mood has passed, N12).
 * ContextAssembler.cs:597-608, verbatim formatting.
 */
export function renderEmotion(emotion: Affect | undefined | null, now: number): string | null {
  if (!emotion) return null;
  const cur = affectCurrent(emotion, now);
  if (cur < EMOTION_FLOOR) return null;
  const intensity = cur.toFixed(1);
  const label = (emotion.label ?? '').trim();
  return label
    ? `此刻心绪：${label}（强度 ${intensity}，正缓缓平复）`
    : `此刻心绪：（强度 ${intensity}，正缓缓平复）`;
}

/**
 * §5.5 per-target block (ContextAssembler.cs:670-718). v3.5 (Memory plan
 * §3.2): reflectionSummary + impressionDelta have moved to the §6
 * knowledgeFact block — this function renders affection + (optional §6
 * per-target knowledge sub-block) + ring, in that order. §5.5.1
 * affection is read-time decayed (N1); §6 knowledge inserted between
 * affection and ring; §5.5.3 ring last (N12 marker via renderRing).
 * Whole block omitted when all of affection / knowledge / ring are
 * empty (NO bare ·对 X· header).
 */
export function renderPerTarget(
  args: {
    talkeeName: string;
    affection?: Affect | null;
    knowledgeFacts?: readonly KnowledgeFactView[];
    ring?: RingTurn[];
  },
  now: number,
): string | null {
  const hasAffection = !!args.affection;
  const knowledgeStr = renderPerTargetKnowledge(args.knowledgeFacts ?? [], now);
  const ringStr = renderRing(args.ring ?? []);
  if (!hasAffection && !knowledgeStr && !ringStr) return null;

  const out: string[] = [`·对 ${args.talkeeName}·`];
  if (args.affection) {
    const cur = affectCurrent(args.affection, now);
    const val = cur.toFixed(2);
    const label = (args.affection.label ?? '').trim();
    out.push(
      label
        ? `当下好恶：${val}（${label}，向长期基线缓回）`
        : `当下好恶：${val}（向长期基线缓回）`,
    );
  }
  if (knowledgeStr) out.push(knowledgeStr);
  if (ringStr) out.push(ringStr);
  return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// §6 — knowledge-fact render (v3.5, Memory plan §6)
// ─────────────────────────────────────────────────────────────────────

const pad2 = (n: number) => (n < 10 ? '0' : '') + n;

/** YYYY-MM-DD HH:MM in UTC (locale-agnostic; prompt is for Grok). */
function fmtTimestampMin(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
    ` ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
  );
}

/** YYYY-MM-DD in UTC (general block — drops time-of-day per plan §6). */
function fmtTimestampDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * §6 per-target knowledge sub-block — inserted into the per-target
 * block between affection and ring. Two-section layout per plan §6:
 *   1. 【冲突信息】（待澄清）: pinned facts first (N22), most-recent
 *      `lastUpdatedAt` first; half-budget cap enforced by
 *      `sortPerTargetFacts`.
 *   2. Then non-pinned facts under the main 关于此人的记忆 header,
 *      sorted by `importance × frequency × exp(-Δt/τ)` descending.
 * Total rendered ≤ RENDER_FACTS_PER_TARGET. Pre-sort facts include
 * BOTH ST and LT tiers — counts in the header reflect both.
 * Returns null when there are no facts to render (cold-start path —
 * caller omits the whole sub-block; no 关于此人的记忆 placeholder
 * line, since the per-target block is itself optional unlike §6.5
 * general).
 */
export function renderPerTargetKnowledge(
  facts: readonly KnowledgeFactView[],
  now: number,
): string | null {
  if (!facts.length) return null;
  const stCount = facts.reduce((n, f) => n + (f.tier === 'ST' ? 1 : 0), 0);
  const ltCount = facts.length - stCount;
  const { pinned, normal } = sortPerTargetFacts(facts, now, RENDER_FACTS_PER_TARGET);
  if (!pinned.length && !normal.length) return null;

  const lines: string[] = [`关于此人的记忆（短期 ${stCount}条 / 长期 ${ltCount}条）：`];

  // Pinned contradictions under sub-header (N22 — surfaced first).
  if (pinned.length) {
    lines.push('  【冲突信息】（待澄清）：');
    for (const f of pinned) {
      const ts = fmtTimestampMin(f.lastUpdatedAt);
      const imp = `[重要${f.importance}]`;
      const freq = `(×${f.frequency})`;
      lines.push(`    · ${ts} ${imp} ${f.factText ?? ''} ${freq}`.trimEnd());
    }
  }

  // Non-pinned facts under the main header.
  for (const f of normal) {
    const ts = fmtTimestampMin(f.lastUpdatedAt);
    const imp = `[重要${f.importance}]`;
    const freq = `(×${f.frequency})`;
    lines.push(`  · ${ts} ${imp} ${freq} ${f.factText ?? ''}`.trimEnd());
  }

  return lines.join('\n');
}

/**
 * §6 standalone general-knowledge block — about places, time, weather,
 * ambient (multi-modal L8 entries). Format per plan §6 example: no
 * importance prefix, no time-of-day (date only), facts sorted by
 * `factScore` descending with `INSTINCT_RENDER_FLOOR` enforcement
 * (the instinct-floor render guarantee — `sortGeneralFacts` evicts
 * lowest-scoring non-instinct rows to seat instincts when needed).
 * Total rendered ≤ RENDER_FACTS_GENERAL.
 *
 * **Trivial-skip render rule** (plan §6): even when empty (cold-start
 * NPC with no general facts at all), render the header + 「（暂无）」
 * placeholder — NOT the omit-block-entirely path. Keeps prompt
 * structure stable for Grok between cold and warm states.
 */
export function renderGeneralKnowledge(
  facts: readonly KnowledgeFactView[],
  now: number,
): string | null {
  // Header is fixed; body is either fact lines or the placeholder.
  const sorted = sortGeneralFacts(facts, now, RENDER_FACTS_GENERAL);
  const header = `【对世界的认识】（一般记忆，最近${sorted.length}条）：`;
  if (!sorted.length) {
    return `${header}\n  （暂无）`;
  }
  const lines = [header];
  for (const f of sorted) {
    const day = fmtTimestampDay(f.lastUpdatedAt);
    const freq = `(×${f.frequency})`;
    lines.push(`  · ${day} ${freq} ${f.factText ?? ''}`.trimEnd());
  }
  return lines.join('\n');
}
