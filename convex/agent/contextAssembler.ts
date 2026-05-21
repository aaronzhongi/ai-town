// Human-memory port (HumanMemory_AITown_Plan v2). Faithful TS rebuild of
// jynew AI Tavern Phase 3D `ContextAssembler` (extract §4), LORE-FREE:
// §1 WorldCodex (S1) and §4 Dossier (S2) are structurally absent — the
// assembler degrades cleanly, exactly as jynew does when World==null /
// no dossier. Pure: synchronous, zero Grok, zero IO (data is fetched in
// the query layer and passed in).
//
// Section order is FIXED; empty sections are omitted entirely.
// P1-1A populates §2 + §3 only; §5.x (working memory / affect / ring /
// reflection) is added in 1B–1D against this same framework.

import { SECT_SELFBIO_BUDGET, SECT_TALKEE_BUDGET, SECT_SHORTTERM_BUDGET } from '../constants';
import {
  renderWorkingMemory,
  renderRing,
  renderEmotion,
  renderPerTarget,
  RingTurn,
} from './mindState';
import { Affect } from './affect';

export type ContextProfile = 'full' | 'leave';

/** §2 source — the TALKER NPC's own persona-core (talker-only, N9/§6). */
export type TalkerPersona = {
  bioName: string;
  personality: string;
};

/**
 * §3 source — the TALKEE's first-impression surface ONLY. For a PC
 * talkee this comes from `playerPersona` (N13); `sex`/`ageText` may be
 * empty for a PC and are then omitted (faithful lore-free degrade).
 */
export type TalkeeSurface = {
  bioName: string;
  sex: string;
  ageText: string;
  appearance: string;
  surfaceManner: string;
};

/** jynew `AppendSection` — trim, omit-if-empty, hard char-budget cap. */
function appendSection(parts: string[], text: string | null, budget: number): void {
  if (!text) return;
  const t = text.trim();
  if (!t) return;
  parts.push(t.length > budget ? t.slice(0, budget) : t);
}

/** §2 `BuildSelfBio` — the talker's own 性情 (ContextAssembler.cs). */
function buildSelfBio(p: TalkerPersona | null): string | null {
  if (!p) return null;
  const personality = (p.personality ?? '').trim();
  if (!personality) return null;
  const name = (p.bioName ?? '').trim() || '?';
  return `【我是谁 — 自我】\n姓名：${name}\n性情：${personality}`;
}

/**
 * §3 anti-omniscience SEAL (N9). The narrow argument list IS the guard:
 * this signature structurally CANNOT receive the talkee's
 * personality/identity/plans/relationships. DO NOT widen it to accept a
 * persona object. Both appearance+manner empty ⇒ §3 omitted entirely
 * (no lone 性别 line) — ContextAssembler.cs:367.
 */
function buildTalkeeSurfaceSealed(
  bioName: string,
  sex: string,
  ageText: string,
  appearance: string,
  surfaceManner: string,
): string | null {
  const hasAppearance = !!appearance && !!appearance.trim();
  const hasManner = !!surfaceManner && !!surfaceManner.trim();
  if (!hasAppearance && !hasManner) return null;

  let s = `【对面是谁 — 初见印象】\n姓名：${(bioName ?? '').trim() || '?'}`;
  if (sex && sex.trim()) s += `  性别：${sex.trim()}`;
  if (ageText && ageText.trim()) s += `  年龄：${ageText.trim()}`;
  if (hasAppearance) s += `\n外貌：${appearance.trim()}`;
  if (hasManner) s += `\n气度：${surfaceManner.trim()}`;
  return s;
}

/** Public §3 seam — extracts the 5 surface fields only. */
function buildTalkeeSurface(t: TalkeeSurface | null): string | null {
  if (!t) return null;
  return buildTalkeeSurfaceSealed(
    t.bioName,
    t.sex,
    t.ageText,
    t.appearance,
    t.surfaceManner,
  );
}

/**
 * jynew `ContextAssembler.Build` (extract §4). FIXED section order,
 * empty-omission. P1-1A: §1/§4 structurally absent (S1/S2); §5.x added
 * in 1B–1D. Returns the assembled block (to be PREPENDED before the
 * retained legacy memory block during coexistence — §4A).
 */
/** §5.1-5.3 working memory + §5.4 emotion + §5.5 per-target (P1-1B/1C). */
// v3.5 (Memory plan §3.2 / §6): semantic memory (reflectionSummary /
// impressionDelta / globalReflection) is no longer carried on mindState
// — the §6 knowledgeFact block is loaded + rendered separately by the
// ContextAssembler §6 path (lands with Op A wiring). ShortTerm here
// carries the AFFECT layer + working-memory scalars + ring only.
export type ShortTerm = {
  situation?: string;
  task?: string;
  surroundings?: string;
  ring?: RingTurn[];
  // P1-1C affect (read-time decayed via N1):
  emotion?: Affect | null; // §5.4 owner emotion
  affection?: Affect | null; // §5.5.1 per-target affection
  talkeeName?: string; // §5.5 per-target header
  now?: number; // decay clock; defaults to Date.now()
};

export function buildContext(args: {
  profile: ContextProfile;
  talker: TalkerPersona | null;
  talkee: TalkeeSurface | null;
  shortTerm?: ShortTerm | null;
}): string {
  const parts: string[] = [];
  const st = args.shortTerm ?? {};
  const now = st.now ?? Date.now();
  const talkeeName = st.talkeeName ?? args.talkee?.bioName ?? '?';
  if (args.profile === 'full') {
    // §1 World Codex — UNSEEDED (S1): structurally omitted.
    appendSection(parts, buildSelfBio(args.talker), SECT_SELFBIO_BUDGET); // §2
    appendSection(parts, buildTalkeeSurface(args.talkee), SECT_TALKEE_BUDGET); // §3
    // §4 Long-term Dossier — UNSEEDED (S2): structurally omitted.
    appendSection(parts, renderWorkingMemory(st), SECT_SHORTTERM_BUDGET); // §5.1-5.3
    appendSection(parts, renderEmotion(st.emotion, now), SECT_SHORTTERM_BUDGET); // §5.4
    // v3.5: §5.0 globalReflection / §5.5.2 reflectionSummary / §5.5
    // impressionDelta moved to the §6 knowledgeFact block — its render
    // pass is added by Op A wiring. §5.5 here is just affection + ring.
    appendSection(
      parts,
      renderPerTarget(
        {
          talkeeName,
          affection: st.affection ?? null,
          ring: st.ring ?? [],
        },
        now,
      ),
      SECT_SHORTTERM_BUDGET,
    ); // §5.5
  } else {
    // Leave = lean profile: §2 self-bio + §5.4 emotion-only + §5.5.3
    // ring-only (NOT affection/summary) — jynew lean Leave profile.
    appendSection(parts, buildSelfBio(args.talker), SECT_SELFBIO_BUDGET);
    appendSection(parts, renderEmotion(st.emotion, now), SECT_SHORTTERM_BUDGET);
    appendSection(parts, renderRing(st.ring ?? []), SECT_SHORTTERM_BUDGET);
  }
  return parts.join('\n\n');
}

// Exposed for unit tests (N9/N12 suites, §0.5).
export const __test = { buildSelfBio, buildTalkeeSurfaceSealed, buildTalkeeSurface, appendSection };
