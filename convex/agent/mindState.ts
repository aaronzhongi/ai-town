// Human-memory port (HumanMemory_AITown_Plan v2) — P1-1B.
// The episodic ring is a DERIVED READ-ONLY WINDOW over ai-town's durable
// `messages` table (S10), NOT a co-appended structure. jynew's in-memory
// ring + `[spill]`/`IsFolded`/`Ring.Clear()` are unnecessary no-ops here
// (S10): ai-town's `messages` table is the durable per-conversation
// transcript jynew emulated. This module is PURE (no Convex/IO) so the
// window rule is unit-testable; callers pass messages in creation order.

import { MEMORY_RING_CAP, EMOTION_FLOOR } from '../constants';
import { Affect, affectCurrent } from './affect';

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
 * §5.5 per-target block (ContextAssembler.cs:670-718). ALL of
 * affection/summary/impressionDelta/ring empty ⇒ whole block omitted
 * (NO bare ·对 X· header). §5.5.1 affection is read-time decayed (N1)
 * toward its baseline; §5.5.2 settled summary; the relocated
 * ImpressionDelta overlay (S6) is rendered **read-only** here next to
 * the settled summary; §5.5.3 ring last (N12 marker via renderRing).
 */
export function renderPerTarget(
  args: {
    talkeeName: string;
    affection?: Affect | null;
    reflectionSummary?: string | null;
    impressionDelta?: string | null;
    ring?: RingTurn[];
  },
  now: number,
): string | null {
  const hasAffection = !!args.affection;
  const summary = (args.reflectionSummary ?? '').trim();
  const impression = (args.impressionDelta ?? '').trim();
  const ringStr = renderRing(args.ring ?? []);
  if (!hasAffection && !summary && !impression && !ringStr) return null;

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
  if (summary) out.push(`往来印象（已沉淀）：${summary}`);
  if (impression) out.push(`［本局所历］：${impression}`); // S6 overlay, read-only
  if (ringStr) out.push(ringStr);
  return out.join('\n');
}
