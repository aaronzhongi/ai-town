// Memory v3.5 phase 2A.11 — privacy gate for talkee names.
//
// Design principle (user clarification 2026-05-21):
//   - PRIVATE info (name / age / bio): only the owner-character can
//     expose. Other characters do NOT see this at first sight.
//   - PUBLIC info (appearance / surfaceManner / sex): visible to
//     anyone at first sight.
//   - Everything else accumulates through dialog → Op A → knowledgeFact.
//
// Implementation: a name is considered "learned" by an NPC about a
// target once the target has spoken their own name in any past
// conversation AND Op A has captured it into a knowledgeFact row. We
// detect this by scanning the NPC's accumulated knowledgeFact rows
// for the target's displayName substring. Persists naturally across
// conversations because LT-tier rows persist.
//
// Both helpers are pure (no Convex context) for unit testability.
// Callers in conversation.ts / opA.ts pass in the already-loaded
// knowledgeFact slices to avoid double-fetch.

import { KnowledgeFactView } from './knowledgeFacts';

/**
 * Returns true if any knowledgeFact row owned by this NPC contains
 * the target's `displayName` as a substring of factText.
 *
 * Scope: scans ALL provided slices. The caller should pass per-target
 * + __general__ slices across both tiers (Op A may attribute facts
 * to either entity depending on whether name was known at write time
 * — see opA.ts apply path). Persistence across conversations is
 * automatic because the LT slice persists.
 *
 * Empty displayName → false (defensive; never claim a nameless person
 * was "learned").
 */
export function isNameLearned(
  rows: ReadonlyArray<KnowledgeFactView | { factText?: string }>,
  displayName: string,
): boolean {
  const needle = (displayName ?? '').trim();
  if (!needle) return false;
  for (const r of rows) {
    const text = (r.factText ?? '').trim();
    if (text && text.includes(needle)) return true;
  }
  return false;
}

/**
 * Derive a short anonymous label from a talkee's public surface
 * (appearance + surfaceManner). User chose the "derived" path so
 * each NPC's anonymous reference reflects their observable features.
 *
 * Strategy:
 *   1. Try surfaceManner first (more identity-bearing — e.g.
 *      "不自信，躲闪我的目光" → "不自信的人").
 *   2. Fall back to appearance ("一头黑色的直发" → "一头黑色的直发的人").
 *   3. Final fallback: generic "陌生人".
 *
 * Truncation: take the first phrase before a Chinese full-stop (。)
 * or comma (，), then append "的人". The "的人" suffix turns adjective-
 * phrases into noun-phrases (e.g., "不自信" → "不自信的人"). Caps the
 * label at 16 characters to prevent runaway concatenation when
 * surfaceManner is a long single-clause sentence.
 */
const ANON_LABEL_MAX_CHARS = 16;
const ANON_LABEL_FALLBACK = '陌生人';

export function deriveAnonymousLabel(args: {
  appearance?: string;
  surfaceManner?: string;
}): string {
  const firstPhrase = (text: string | undefined): string | null => {
    const t = (text ?? '').trim();
    if (!t) return null;
    // Split on Chinese ， 。 ；ASCII , . ; — any of these terminates
    // the first short phrase.
    const phrase = t.split(/[，。；,.;]/)[0].trim();
    return phrase || null;
  };
  const candidate =
    firstPhrase(args.surfaceManner) ?? firstPhrase(args.appearance);
  if (!candidate) return ANON_LABEL_FALLBACK;
  const label = `${candidate}的人`;
  if (label.length > ANON_LABEL_MAX_CHARS) {
    // Long surface text — fall back to generic rather than emit a
    // mouthful. Keeps the §5.5 ·对 X· header tidy.
    return ANON_LABEL_FALLBACK;
  }
  return label;
}
