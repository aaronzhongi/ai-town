// Human-memory port (HumanMemory_AITown_Plan v3.1) — P1-1D core.
// Faithful TS rebuild of jynew AI Tavern Phase 3D MemoryCompactor's
// PURE pieces: prompt builders + slot extractor + per-slot parsers +
// ImpressionDelta append. Algorithm bodies verbatim per
// _jynew_phase3d_extract.md §3 (MemoryCompactor.cs:454-630).
//
// Generic-persona framing per S5/S7: 武侠 phrasing dropped; 违背设定
// slot reframed to reference the talker's authored §2 personality
// (provided in the user body as 自我设定). The 4-slot output contract,
// raw-only input rule, attribution-句式 rule, Chinese-only rule, and
// "缺失内容写「空」" rule are kept verbatim — the parser keys on the
// byte-identical slot prefixes.
//
// Pure: no Convex/IO. Caller wires Grok + DB I/O in agentRememberConversation.

import {
  AFFECT_DELTA_DEADBAND,
  EMOTION_DEFAULT_INTENSITY,
  GLOBAL_REFLECTION_MAX_CHARS,
  IMPRESSION_DELTA_MAX_CHARS,
  IMPRESSION_DELTA_MAX_ENTRIES,
} from '../constants';

// ──────────────────────────────────────────────────────────────────
// Slot prefixes (byte-identical to jynew MemoryCompactor.cs:44-47).
// Parser keys on these exact strings.
// ──────────────────────────────────────────────────────────────────
export const SLOT_IMPRESSION = '往来印象：';
export const SLOT_EMOTION = '情绪变化：';
export const SLOT_AFFECTION = '好恶变化：';
export const SLOT_CONTRADICTION = '违背设定：';
const ALL_SLOTS = [SLOT_IMPRESSION, SLOT_EMOTION, SLOT_AFFECTION, SLOT_CONTRADICTION] as const;

// IsNeutralLabel set (jynew MemoryCompactor.cs:548-562, verbatim).
const NEUTRAL_LABELS = new Set([
  '平静',
  '无',
  '无明显变化',
  '无变化',
  '空',
  'none',
  'None',
  'neutral',
  'Neutral',
]);

// ──────────────────────────────────────────────────────────────────
// §5.3 4-slot reflection prompt — generic-persona framing (S5/S7).
// Per R3 lens-3 R-2 fold: 违背设定's reference frame is explicitly
// named as the talker's authored §2 personality (provided in user body
// as 自我设定). Verbatim-faithful otherwise.
// ──────────────────────────────────────────────────────────────────
export function buildReflectSystemPrompt(): string {
  return [
    '你在做「记忆沉淀」：把这位角色刚结束的一段对话，' +
      '整理成他/她对对方的持久记忆，并判断这段经历对他/她情绪与好恶的净影响。',
    '',
    '仅输出中文。所有判断只依据下面给出的【原始逐字对话】本身，' +
      '不要臆测对话之外的事，也不要沿用任何先前印象——这是为防止记忆失真。',
    '',
    '复述对方言行时用归属句式（「他/她声称」「据其所见」「他/她抱怨」等），' +
      '不要用全知视角把任一方的话当作既成事实（人物会撒谎、虚张声势、口是心非）。',
    '',
    '情绪变化、好恶变化必须依据这段原始对话里实际发生的事来判断' +
      '（即便其中的激烈时刻在现实里已经过去，也要如实记入沉淀）。',
    '',
    '严格按以下四行输出，每行以给定前缀开头，缺失内容写「空」：',
    SLOT_IMPRESSION + '<2-4句，沉淀下来的关系认知，用归属句式>',
    SLOT_EMOTION + '<情绪词 + 强度0~1，例如「警惕 0.6」；若本局平淡写「平静」>',
    SLOT_AFFECTION + '<带符号的好恶增量，区间[-1,1]，例如「-0.25」；若几乎无变化写「0」>',
    SLOT_CONTRADICTION +
      '<空，或一句简述：原始对话里是否有与下文「自我设定」' +
      '（即记忆主人的人物设定，作为判断「违背设定」的唯一参照）或常识明显矛盾之处>',
  ].join('\n');
}

/** Per N13: ownerName + otherName are DISPLAY NAMES, never raw ids. */
export function buildReflectUserBody(args: {
  ownerName: string;
  ownerPersonality: string;
  otherName: string;
  rawConcat: string;
}): string {
  const personality = (args.ownerPersonality ?? '').trim();
  const owner = (args.ownerName ?? '').trim() || '?';
  const other = (args.otherName ?? '').trim() || '?';
  const raw = args.rawConcat ?? '';
  const parts = [`记忆的主人：${owner}`];
  if (personality) parts.push(`自我设定：${personality}`);
  parts.push(`对话的另一方：${other}`);
  parts.push('');
  parts.push('【原始逐字对话】');
  parts.push(raw);
  return parts.join('\n') + (raw.endsWith('\n') ? '' : '\n');
}

// ──────────────────────────────────────────────────────────────────
// §5.0 GlobalReflection — verbatim jynew prompts. Faithful, kept
// generic-friendly (no canon refs). S4: this op is gated to no-op for
// a single pair (callers check pairs.length ≥ 2).
// ──────────────────────────────────────────────────────────────────
export function buildGlobalReflectSystemPrompt(): string {
  return [
    '你在做「跨人反思」：下面是这位角色此刻对他/她所认识的几个人各自的印象' +
      '（每条都是已经沉淀好的逐对印象，不是原始对话）。',
    '',
    '仅输出中文。请站在这个角色的角度，综观这几条印象，用不超过两句话点出' +
      '你从这群人身上整体感到的共同点或暗流。',
    '',
    '用归属句式（「我察觉」「众人似乎」「他们都」等），' +
      '不要逐条复述每个人的印象——那是逐对记忆已经做过的；' +
      '这里只综合出整体的模式或暗流。',
    '',
    '只输出这一两句话本身，不要加前缀、标号或解释。',
  ].join('\n');
}

export function buildGlobalReflectUserBody(args: {
  ownerName: string;
  pairs: ReadonlyArray<{ name: string; summary: string }>;
}): string {
  const owner = (args.ownerName ?? '').trim() || '?';
  const lines = [`反思的主人：${owner}`, '', '【我对各人当前的印象】'];
  for (const p of args.pairs) {
    const name = (p.name ?? '').trim() || '?';
    const summary = (p.summary ?? '').replace(/\n/g, ' ').trim();
    if (!summary) continue;
    lines.push(`「${name}」：${summary}`);
  }
  return lines.join('\n');
}

/** Trim a global-reflection Grok response to the rendered char cap (N10/S4). */
export function clampGlobalReflection(raw: string): string {
  const t = (raw ?? '').trim();
  return t.length > GLOBAL_REFLECTION_MAX_CHARS
    ? t.slice(0, GLOBAL_REFLECTION_MAX_CHARS).trim()
    : t;
}

// ──────────────────────────────────────────────────────────────────
// Slot extraction — finds a slot's content from the model output.
// Content runs from after `prefix` until the next slot prefix or EOS.
// Returns null when the prefix is not present (caller treats as "空").
// ──────────────────────────────────────────────────────────────────
export function extractSlot(text: string, prefix: string): string | null {
  if (!text) return null;
  const start = text.indexOf(prefix);
  if (start < 0) return null;
  const contentStart = start + prefix.length;
  // Find earliest next slot prefix occurring AFTER our content starts.
  let end = text.length;
  for (const other of ALL_SLOTS) {
    if (other === prefix) continue;
    const idx = text.indexOf(other, contentStart);
    if (idx >= 0 && idx < end) end = idx;
  }
  return text.slice(contentStart, end).trim();
}

// ──────────────────────────────────────────────────────────────────
// ExtractFirstFloat — finds the first signed float in the string.
// Jynew MemoryCompactor.cs:576-609, verbatim semantics. Handles e.g.
// "警惕 0.6", "-0.25", "+0.6", ".5", "（0.6）".
// ──────────────────────────────────────────────────────────────────
const isDigit = (c: string) => c >= '0' && c <= '9';

export function extractFirstFloat(
  s: string,
): { value: number; start: number; len: number } | null {
  if (!s) return null;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const isSign = (c === '-' || c === '+') && i + 1 < s.length && (isDigit(s[i + 1]) || s[i + 1] === '.');
    const isDotStart = c === '.' && i + 1 < s.length && isDigit(s[i + 1]);
    if (isDigit(c) || isSign || isDotStart) {
      let j = i;
      if (s[j] === '-' || s[j] === '+') j++;
      let seenDot = false;
      while (j < s.length && (isDigit(s[j]) || (s[j] === '.' && !seenDot))) {
        if (s[j] === '.') seenDot = true;
        j++;
      }
      const num = s.substring(i, j);
      const parsed = parseFloat(num);
      if (!Number.isNaN(parsed)) {
        return { value: parsed, start: i, len: j - i };
      }
    }
    i++;
  }
  return null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

// Strip the separators jynew strips after pulling the magnitude.
function stripLabelSeparators(s: string): string {
  return s
    .trim()
    .replace(/^[（）()，,：:、强度\s]+|[（）()，,：:、强度\s]+$/g, '')
    .trim();
}

export function isNeutralLabel(label: string): boolean {
  if (!label || !label.trim()) return true;
  return NEUTRAL_LABELS.has(label.trim());
}

/**
 * ParseEmotion — jynew MemoryCompactor.cs:511-543, verbatim. Returns
 * { label, intensity, isNeutral }. Defaults: empty → 平静/0/neutral.
 * Non-neutral with no magnitude → uses EMOTION_DEFAULT_INTENSITY (0.5).
 */
export function parseEmotion(slot: string | null | undefined): {
  label: string;
  intensity: number;
  isNeutral: boolean;
} {
  if (!slot || !slot.trim()) {
    return { label: '平静', intensity: 0, isNeutral: true };
  }
  const text = slot.trim();
  const mag = extractFirstFloat(text);
  let lblRaw: string;
  if (mag) {
    lblRaw = text.substring(0, mag.start) + text.substring(mag.start + mag.len);
  } else {
    lblRaw = text;
  }
  const label = stripLabelSeparators(lblRaw);
  if (isNeutralLabel(label)) {
    return { label: label || '平静', intensity: 0, isNeutral: true };
  }
  const intensity = mag ? clamp01(mag.value) : EMOTION_DEFAULT_INTENSITY;
  return { label, intensity, isNeutral: false };
}

/** ParseAffectionDelta — first signed float, clamp [-1,1]; else 0. */
export function parseAffectionDelta(slot: string | null | undefined): number {
  if (!slot || !slot.trim()) return 0;
  const f = extractFirstFloat(slot.trim());
  if (!f) return 0;
  return clamp(f.value, -1, 1);
}

/** HasContradiction — non-empty AND not literal "空" (jynew). */
export function hasContradiction(slot: string | null | undefined): boolean {
  if (!slot) return false;
  const t = slot.trim();
  if (!t) return false;
  if (t === '空') return false;
  return true;
}

// ──────────────────────────────────────────────────────────────────
// Salience gate predicate (N6, MemoryCompactor.cs:232-235).
// trivial = (|affDelta| < AFFECT_DELTA_DEADBAND) AND emotionNeutral.
// When trivial: summary still folded; only affect/LastSetMs skipped.
// ──────────────────────────────────────────────────────────────────
export function isTrivial(affDelta: number, emotionNeutral: boolean): boolean {
  return Math.abs(affDelta) < AFFECT_DELTA_DEADBAND && emotionNeutral;
}

// ──────────────────────────────────────────────────────────────────
// AppendImpressionDelta — bounded overlay append (S6 relocated to §5.5).
// Cap: IMPRESSION_DELTA_MAX_ENTRIES (3) entries; IMPRESSION_DELTA_MAX_CHARS
// (600) total chars. One entry per line: "yyyy-MM-dd HH:mm · <summary>".
// Older entries dropped first; char overflow trimmed from front.
// ──────────────────────────────────────────────────────────────────
function formatStamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function appendImpressionDelta(
  existing: string | null | undefined,
  addition: string | null | undefined,
  now: number,
): string {
  const newSummary = (addition ?? '').trim();
  if (!newSummary) return (existing ?? '').trim();
  const newEntry = `${formatStamp(now)} · ${newSummary.replace(/\n+/g, ' ')}`;
  const SEP = '\n';
  const entries = existing && existing.trim() ? existing.split(SEP) : [];
  entries.push(newEntry);
  const recent = entries.slice(-IMPRESSION_DELTA_MAX_ENTRIES);
  let out = recent.join(SEP);
  if (out.length > IMPRESSION_DELTA_MAX_CHARS) {
    // Trim from front (oldest) preserving newest entries.
    out = '…' + out.slice(out.length - IMPRESSION_DELTA_MAX_CHARS + 1);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────
// buildRawBody — concatenates conversation turns into the body fed
// to the reflection prompt. Per N4 / S10: oldest-first; speaker uses
// display name (N13). Empty turns dropped.
// ──────────────────────────────────────────────────────────────────
export function buildRawBody(
  turns: ReadonlyArray<{ speaker: string; text: string }>,
): string {
  const lines: string[] = [];
  for (const t of turns) {
    const txt = (t.text ?? '').trim();
    if (!txt) continue;
    const sp = (t.speaker ?? '').trim() || '?';
    lines.push(`${sp}: ${txt}`);
  }
  return lines.join('\n');
}
