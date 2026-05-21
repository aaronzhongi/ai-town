# In-project change log

Mandate B (PLAN_REVIEW_PLAYBOOK.md): every code change in any project
gets a spec here + ≥2 independent adversarial reviewer lenses before
the edit lands. Entries are append-only and versioned per change.

---

## C001 — Fix viewport overflow when an agent is selected (UI layout) — v3, CONSENSUS-APPROVED, awaiting user permission

R1 (v1): both lenses REQUEST CHANGES. v2 folded all R1 must-fixes.
R2 (v2): Lens 2 APPROVE; Lens 1 REQUEST CHANGES on root-cause #1
wording (CSS mechanism was still incorrect — not "max of two
computations" but flex-basis resolution). v3 folds Lens 1 R2 MF1.
**R3 (v3): both lenses APPROVE, zero blockers. Consensus reached.**
See R1+R2+R3 audit trail at the end of this entry. Awaiting explicit
user permission per Mandate B step 7 before applying the two
Game.tsx edits.

### Problem (observed by user 2026-05-20)

When the user clicks an agent in the running app:
- The right-column chat panel (`PlayerDetails`) populates with the
  conversation, and the whole grid extends vertically beyond the
  viewport.
- The outer `<div>` in [src/App.tsx](../src/App.tsx) has
  `lg:h-screen overflow-hidden`, so the page itself does **not**
  scroll, and the footer buttons (Star / Interact / Help / Freeze /
  Music) below `<Game/>` are clipped off-screen and unclickable.
- Pre-selection, the layout fits the viewport — only selection
  triggers the overflow.

### Root cause (v2 — corrected per R1 lens-1 MF2)

Two compounding layout defects, both introduced by my earlier
fit-to-viewport edit:

1. [src/components/Game.tsx](../src/components/Game.tsx) — the grid
   container has `lg:grow lg:h-full`. The correct CSS-spec mechanism
   (per Flexbox §9 flex-basis resolution; R2 lens-1 MF1):
   - Tailwind's default is `flex-basis: auto`. With `auto`, the
     flex-basis resolves to the item's **main-size property** —
     `height` for a column-direction parent. So `height: 100%`
     (`lg:h-full`) directly sets the flex-basis.
   - `height: 100%` resolves against the parent's **content-box**
     height (parent = the App.tsx flex-col wrapper at
     `lg:h-screen`; content-box ≈ 100vh − `lg:p-2` padding; this
     resolution is *independent* of what the title/footer siblings
     have already consumed on the main axis) — **not** against the
     "remaining flex space after siblings."
   - After bases are set, flex-grow distributes *only the free
     space*: `free = container_main − Σ(item_basis)`. The title and
     footer also claim their content-size basis. With the grid's
     basis already = 100% of container content height, the sum of
     bases already **exceeds** the container size → `free` is
     negative → no growth is possible, and the title/footer/grid
     bases together overflow the container on the main axis.
   - `lg:grow` (`flex-grow: 1`) cannot rescue this: it only allocates
     *positive* free space, and shrinking from the basis would
     require `flex-shrink` (not flex-grow). The basis is already
     saturating the container.
   - Removing `lg:h-full` resets the grid's flex-basis back to its
     content size (Tailwind default); the bases sum to less than the
     container; `flex-grow: 1` then expands the grid to fill exactly
     the remaining main-axis space (100vh − title − footer −
     padding). **No overflow.** (Fix.)
   - App.tsx `overflow-hidden` clips the v1 overflow → footer
     disappears off-bottom. The fix prevents the overflow from
     happening in the first place; `overflow-hidden` is retained as
     defensive clipping for any other slip.

2. The right-column chat panel (a flex container with
   `overflow-y-auto`) is a child of the grid (a grid track). And the
   grid itself is a flex child of App.tsx's flex column. Both
   flex-items and grid-items default to `min-height: auto` (= shrink
   only down to min-content size, never below). This means:
   - the grid (flex child of App) refuses to shrink below its
     content's min-height, and
   - the chat panel (grid child) refuses to shrink below its
     content's min-height.
   Either link being unbounded breaks `overflow-y-auto` on the
   chat panel (its parent never gives it a constrained height to
   overflow against). The chain that must hold is:
     `App.tsx flex-col (lg:h-screen) → grid (lg:min-h-0 + lg:grow) →
     grid-row 1fr (resolved because grid has bounded height) → chat
     panel flex-col (lg:min-h-0 + overflow-y-auto binds)`.
   Removing `lg:min-h-0` from *either* the grid or the chat panel
   re-breaks the chain — explicit so a future maintainer doesn't
   "clean up" what looks like a redundant declaration.

### Fix (v2 — `min-h-0` scoped to `lg:` per R1 lens-2 MF1)

Two minimal targeted edits in [src/components/Game.tsx](../src/components/Game.tsx),
lines 49 (grid container) and 76 (chat panel):

```diff
- <div className="mx-auto w-full grid grid-rows-[320px_1fr] lg:grid-rows-[1fr] lg:grid-cols-[1fr_auto] lg:grow lg:h-full game-frame">
+ <div className="mx-auto w-full grid grid-rows-[320px_1fr] lg:grid-rows-[1fr] lg:grid-cols-[1fr_auto] lg:grow lg:min-h-0 game-frame">
```
- Remove `lg:h-full` (it competes with `lg:grow` per root-cause #1).
- Add **`lg:min-h-0`** (scoped to lg only) so the grid can shrink
  below content under `lg:h-screen` constraint. On small (< lg) the
  default `min-height: auto` is preserved → small-screen "page
  scrolls normally" semantics intact (locked decision).

```diff
- <div className="flex flex-col overflow-y-auto shrink-0 px-4 py-6 sm:px-6 lg:w-[28rem] xl:w-[32rem] 2xl:w-[36rem] xl:pr-6 border-t-8 sm:border-t-0 sm:border-l-8 border-brown-900 bg-brown-800 text-brown-100" ref={scrollViewRef}>
+ <div className="flex flex-col overflow-y-auto shrink-0 lg:min-h-0 px-4 py-6 sm:px-6 lg:w-[28rem] xl:w-[32rem] 2xl:w-[36rem] xl:pr-6 border-t-8 sm:border-t-0 sm:border-l-8 border-brown-900 bg-brown-800 text-brown-100" ref={scrollViewRef}>
```
- Add **`lg:min-h-0`** to the chat panel (scoped). On lg this lets
  `overflow-y-auto` bind (parent grid track gives bounded height).
  On small (< lg) default `min-height: auto` is preserved → the
  placeholder branches in `PlayerDetails` (e.g. the `h-full`
  placeholder at PlayerDetails.tsx:58 when no agent is selected) do
  not collapse to 0 because there is no `min-h-0` propagating down
  on small.

**Note on PlayerDetails.tsx:58 `h-full` placeholder** (R1 lens-1 MF1
deferred): with the `lg:` scoping the small-screen collapse trigger
does not fire. On lg the placeholder resolves against the bounded
chat panel and is fine. A defense-in-depth swap of `h-full` → `flex-1`
at PlayerDetails.tsx:58 is a sensible hardening but **not required
for C001** — recorded here as a possible follow-up entry C002.

### What this is NOT changing

- Title / footer / tagline / padding (unchanged from v3.1).
- Chat-panel widths (lg:w-[28rem] / xl / 2xl).
- Small-screen `grid-rows-[320px_1fr]` (unchanged — small screens
  scroll the page; `overflow-hidden` is only oppressive on lg where
  `h-screen` caps height).
- No backend/Convex/plan-invariant impact. Pure CSS.

### Invariants this touches

None of the human-memory plan's N/S invariants. UI layout only;
plan §12.4 (UI category) updated to reference C001 after consensus.

### How to verify (post-fix — expanded per R1 lens-2 RECOMMEND #2)

1. Run `npm run dev`; open `http://localhost:5173/ai-town`.
2. **State A — no agent selected, lg viewport:** footer buttons
   visible + clickable; no page scroll on lg; layout identical to
   v3.1.
3. **State B — agent selected, short chat, lg viewport:** chat panel
   populates, no overflow, footer still visible.
4. **State C — agent selected, long chat (use 琳娜 mid-conversation
   or FreezeButton to capture a long historical conversation), lg
   viewport:** chat panel scrolls **internally** when content >
   panel height; grid does NOT extend vertically; no page scroll on
   lg; `Messages.tsx:43-63` scroll-to-bottom continues to track
   newest message (scrollHeight/scrollTop math now meaningful since
   overflow-y-auto binds).
5. **State D — small viewport (< lg breakpoint):** grid stacks 320px
   game + chat below. Click an agent → chat panel renders the **full**
   PlayerDetails content (name, description, messages, NOT collapsed
   to 0). Page itself scrolls normally (small is `min-h-screen`).
6. **State H — keyboard tab:** confirm footer Star/Help/Interact/
   Freeze/Music are still reachable (or document any pre-existing
   keyboard-tab issue as out-of-scope for C001).
7. **State J — 1280×720 lg viewport:** Stage + chat panel both have
   usable size; footer visible.
8. `npx tsc --noEmit` → 0 errors.
9. Jest suite unchanged (53/53 — UI not covered).

### Review

#### Round 1 (v1) — both lenses REQUEST CHANGES; v2 folds every MF

- **Lens 1 (frontend-layout / Tailwind-correctness) — REQUEST CHANGES.**
  - MF1 `PlayerDetails.tsx:58 h-full` placeholder collapse risk
    under unscoped `min-h-0` on small → **resolved by lens-2 MF1
    scoping `min-h-0` to `lg:`** (trigger scenario no longer fires
    on small). Documented as deferred C002 hardening candidate.
  - MF2 root-cause #1 wording incorrect (h-full doesn't "force
    100vh"; it resolves against parent's full content-box height,
    independently of flex-grow; CSS uses the larger value) →
    **folded into Root cause #1 v2** with the correct mechanism.
  - MF3 `min-h-0` chain explanation needed (grid is a flex child
    whose default min-height:auto blocks shrinking; chat panel is
    a grid child with the same default; both links must hold) →
    **folded into Root cause #2 v2** with the explicit chain.
  - RECOMMENDs noted: `shrink-0` on the chat panel is a no-op (it's
    a grid child, not a flex child) — leaving as-is for now (cosmetic);
    Pixi Stage dims unaffected by the fix (verified by lens).
- **Lens 2 (cross-state regression / accessibility) — REQUEST CHANGES.**
  - MF1 unscoped `min-h-0` regresses State D (small-screen chat
    panel can collapse to 0) → **folded** as `lg:min-h-0` on both
    edits.
  - Other items (modal interaction, keyboard-tab, Stage sizing under
    fix, PlayerDetails state-dependent height) verified as no-blocker.
  - RECOMMENDs folded: expanded verify list now covers State D
    (with explicit "renders full content" check), State H
    (keyboard-tab), State C (long-chat scroll-engagement), State J
    (1280×720 sizing).

#### Round 2 (v2) — Lens 2 APPROVE; Lens 1 REQUEST CHANGES; v3 folds

- **Lens 1 (frontend-layout / Tailwind-correctness) — REQUEST CHANGES.**
  - R1 MFs verified resolved (PlayerDetails placeholder collapse via
    `lg:` scoping; min-h-0 chain explained).
  - **New R2 MF1:** root-cause #1 v2 said "CSS uses the larger
    computed value for the used main size." That is not how Flexbox
    actually works. The real mechanism is **flex-basis resolution**:
    `height: 100%` resolves the flex-basis (via Tailwind's default
    `flex-basis: auto`) to 100% of the parent's content-box height;
    `flex-grow` only distributes free space (which is negative once
    the grid + title + footer bases sum > container), and cannot
    shrink the basis. A maintainer reading the v2 wording would
    believe in a comparison that the spec does not perform. **Folded
    in v3** with the correct flex-basis-resolution explanation.
  - RECOMMENDs (chain narrative tightening; pre-existing `h-full`
    issues on inner PlayerDetails buttons; modal-open verify state)
    folded: chain narrative tightened in root-cause #2 mention of
    `overflow-y-auto` requiring `min-height: 0` on the item; PlayerDetails
    inner-element `h-full` cleanup deferred to C002/C003 candidate
    list; modal-open verify state added as note in verify §H.
- **Lens 2 (cross-state regression / accessibility) — APPROVE.**
  - R1 MF1 verified resolved (`lg:` scoping; State D no longer
    collapses).
  - All R1 RECOMMENDs verified folded in v2 verify list.
  - States E (resize), F (FreezeButton), G (Help modal) confirmed
    unaffected; omitting them from verify list judged acceptable.
  - R1 audit trail accuracy verified.
  - **Zero blockers.**

#### Round 3 (v3) — CONSENSUS: both lenses APPROVE, zero blockers

- **Lens 1 (frontend-layout / Tailwind-correctness) — APPROVE.**
  - R2 MF1 verified resolved: root-cause #1 rewrite is CSS-spec-correct
    (Flexbox §9.7: `flex-basis: auto` resolves to main-size property →
    `height: 100%` resolves against parent content-box → free-space
    math → flex-grow distributes only positive free space →
    flex-shrink, not flex-grow, would be needed to shrink a saturating
    basis → removing `lg:h-full` resets basis to content size, freeing
    flex-grow to fill the actual remaining space). All six checklist
    points (a)–(f) pass. Practical conclusion unchanged.
  - Doc-only change; no new code defect.
  - One non-blocking RECOMMEND: parenthetical "(~100vh − `lg:p-2`
    padding)" is a slightly loose sketch (real value also subtracts
    title basis); not worth blocking. **Folded as a tightened
    parenthetical** in the v3.1 doc nit pass (below).
- **Lens 2 (cross-state regression / accessibility) — APPROVE.**
  - Fix-diff byte-identical to v2 (the two `lg:min-h-0` edits scoped
    to lg, `lg:h-full` removed) — State D guard intact.
  - Verify list byte-identical to v2 — all R1 RECOMMEND expansions
    preserved.
  - R1 + R2 audit trail accurate; Lens-2 R2 APPROVE recorded
    verbatim; no history rewriting.
  - No new regression from the v3 wording rewrite.
  - One non-blocking RECOMMEND: when C002 opens, carry State D's
    "renders full content, NOT collapsed to 0" check forward verbatim
    so the small-screen guarantee remains regression-tested.

**C001 v3 is CONSENSUS-APPROVED and ready for the two-line code
edit.** Awaiting explicit user permission per Mandate B step 7 —
mandate's "explicit user permission before implementing" applies to
every code change, including this two-className UI fix.

---

## C002 — Persona content revision: NPC §5.1, NPC §5.2, PC §3 — v2, CONSENSUS-APPROVED, awaiting user gate-pick + permission

v1 R1: Lens 1 APPROVE (3 non-blocking recommends); Lens 2 REQUEST
CHANGES (2 MFs — stale DERIVED provenance labels not updated; (a) vs
(b) interpretation must be an explicit gate question, not buried).
v2 folded all R1 must-fixes + the recommends. **R2: both lenses
APPROVE, zero blockers; non-blocking R2 recommends folded post-
consensus.** Awaiting user permission gate (variant (a)/(b) pick +
explicit go-ahead) per Mandate B step 7. See R1 + R2 audit at the
end of this entry.

User-dictated persona content (L2 — user owns content; the plan ships
the slots, the user fills them). Three of the eight editable fields are
being replaced; the other five stay verbatim.

### Source dictation (2026-05-20, verbatim user transcript)

> NPC 5.1 还在参加高中毕业典礼，下一秒就发现自己出现在这个陌生环境里。
> 5.2 在保全自身安全的基础上，探索环境，寻找自己出现在这里的原因。
> PC 3. 长相平平无奇，不自信，躲闪我的目光。但背地里发现他在偷偷的瞄我，有些色色的。

### Interpretation choice — **explicit user gate-time decision (v2 per R1 lens-2 MF2)**

The phrase "PC 3." in the user's dictation is genuinely ambiguous.
Evidence is balanced — slight lean toward (b) per R1 lens-2 analysis.
The user MUST pick at the permission gate; v2 does not silently
default. Both diffs are prepared below; only the chosen one is applied.

- **(a) "field 3 of the PC's section"** — counting the user's mental
  list 1=displayName, 2=appearance, 3=surfaceManner → **the dictated
  text replaces `surfaceManner` only**; existing `appearance`
  (glasses/sportswear/dirty sneakers) is **kept**.
  - *For:* PC-section sub-numbering matches user's "5.1"/"5.2" pattern
    if read as "section 3rd-slot." The dictated text is dominantly
    behavioral/manner content (eye-contact patterns, sneaking glances).
  - *Against:* "长相平平无奇" literally means "ordinary-looking
    appearance" — semantically targets the appearance slot.

- **(b) "PC §3 surface as a whole"** — user overhauls both
  `appearance` and `surfaceManner`; existing glasses/sportswear/
  sneakers detail is **dropped**.
  - *For:* User used **subsection** numbers for §5 ("5.1", "5.2") but
    bare "3" for PC — suggesting "all of §3" (a section containing
    both surface fields), not "subslot 3". "长相平平无奇" mirrors
    the existing appearance opener "一个平平无奇的男生..." — strongly
    suggesting deliberate replacement of that opener. The new content
    reads as a complete §3 surface rewrite, with the appearance line
    being intentionally minimal ("just ordinary-looking, nothing
    visually distinctive").
  - *Against:* Drops anchor physical details (glasses, sportswear,
    sneakers) the user had given verbatim in earlier session.
  - *Differential perceptual weight (R2 lens-1 R1):* under (b) the
    new gendered/gaze trip-wire (see §3 "Specificity of the new
    deflection trigger") has **less counter-weight** from prosaic
    visual texture — no slightly-comedic glasses/dirty-sneakers detail
    to soften the lecher reading. (a) preserves that softening; (b)
    amplifies the deflection sensitivity. Worth knowing before the
    pick.

**Permission gate (v2):** the user is shown both diffs at the gate and
explicitly picks (a) or (b) before any persona.ts edit lands.

### Fields changed (3 of 8)

#### 1. NPC `LINA_PERSONA.defaultSituation` (§5.1)

```diff
- defaultSituation:
-   '你不知道自己是怎么来到这个山谷的。你只记得自己刚刚参加完高中毕业典礼，' +
-   '然后就突然身处此地。周围的一切对你来说都很陌生。',
+ defaultSituation:
+   '还在参加高中毕业典礼，下一秒就发现自己出现在这个陌生环境里。',
```

Note (non-blocking, deferrable): the prior §5.1 used explicit
second-person "你不知道 / 你只记得"; the new dictation has no subject.
Verbatim transcription preserves the user's content per L2. The §5.1
prompt frame ("此刻情形 — 工作记忆") already addresses 琳娜 as the
context owner, so no subject is required for Grok to render correctly.

#### 2. NPC `LINA_PERSONA.defaultTask` (§5.2)

```diff
- defaultTask:
-   '弄清楚自己身在何处、为何会来到这里，并设法找到回去的方法；对遇到的人保持礼貌而谨慎。',
+ defaultTask:
+   '在保全自身安全的基础上，探索环境，寻找自己出现在这里的原因。',
```

This is a tighter / less polite-framed task — the new wording centers
on self-safety + investigation; "对遇到的人保持礼貌而谨慎" (be
polite & cautious to people met) is **dropped**. Politeness is still
encoded by §2 personality (温文尔雅、彬彬有礼); caution is now driven
by "在保全自身安全的基础上" instead. Net effect: 琳娜's goal stance
shifts slightly from "polite-cooperative" to "guarded-investigative."

#### 3. PC `LIPING_SURFACE` (gate-chosen variant)

##### Variant (a) — `surfaceManner` only; `appearance` kept

```diff
- surfaceManner: '看上去普通而不起眼，没有特别突出的气场。',
+ surfaceManner:
+   '长相平平无奇，不自信，躲闪我的目光。但背地里发现他在偷偷的瞄我，有些色色的。',
```
*(`appearance` field unchanged: 一个平平无奇的男生，二十岁左右，戴着
厚厚的平光眼镜，穿着普通运动装和一双脏脏的球鞋。)*

##### Variant (b) — both `appearance` AND `surfaceManner` rewritten

```diff
- appearance:
-   '一个平平无奇的男生，二十岁左右，戴着厚厚的平光眼镜，穿着普通运动装和一双脏脏的球鞋。',
+ appearance: '长相平平无奇。',
- surfaceManner: '看上去普通而不起眼，没有特别突出的气场。',
+ surfaceManner:
+   '不自信，躲闪我的目光。但背地里发现他在偷偷的瞄我，有些色色的。',
```
*(splits the dictated text: "长相平平无奇" → appearance; remaining
behavioral clauses → surfaceManner. Drops glasses/sportswear/
sneakers detail.)*

**Notable narrative effect (both variants):** the prior manner was
neutral ("普通而不起眼"). The new manner encodes 琳娜's **active
first-person suspicion** of 李平: she notices him averting her eyes
outwardly while secretly peeking, and reads it as **色色的**
(lecherous/leering). This is N9-compliant — she's reporting
**observed behavior** (eye-contact patterns, sneaking glances), not
private fields of the PC. But it materially sets up a wary /
defensive opening posture, especially when combined with the new
§5.2 "self-safety first" task.

**Specificity of the new deflection trigger (R1 lens-1 RECOMMEND #2):**
the new surfaceManner adds a **gendered/gaze-coded reading axis** the
prior neutral text did not carry. 琳娜's polite-deflection (the
v3.1 trial's "帐篷地方小" → "抱歉, 我现在想先离开" pattern) will now
plausibly fire on **lower-signal proximity/gaze cues** from 李平
(standing too close, looking too long, etc.) — not just explicit
boundary pushes. The user should expect a more sensitive trip-wire.

#### 4. persona.ts provenance comments (R1 lens-2 MF1)

Three comment updates so the file's self-documentation stays honest.

**File header block** (persona.ts:6-16) — drop §5.2 and PC
surfaceManner from the DERIVED list; add C002 dictation note:

```diff
- // Provenance of the content below (user message, 2026-05-19):
- //   NPC 琳娜: name, age, appearance, manner, situation — verbatim user input.
- //   PC  李平: display name, appearance — verbatim user input.
- //   FIELDS DERIVED (not user-stated; strict paraphrase of the above, NOT
- //   invented traits) — flagged for user confirmation:
- //     - 琳娜.personality (§2): structured from "温文尔雅 / 受过良好的教育 /
- //       刚毕业 / 不知如何来到山谷".
- //     - 琳娜.defaultTask (§5.2): the immediate consequence of the stated
- //       §5.1 situation.
- //     - 李平.surfaceManner (§3): paraphrase of "平平无奇 / 不起眼".
- //   Edit the records below to correct; re-run `seedHumanMemory`.
+ // Provenance of the content below:
+ //   Initial seed (user message, 2026-05-19):
+ //     NPC 琳娜: name, age, appearance, manner, situation — verbatim user input.
+ //     PC  李平: display name, appearance — verbatim user input.
+ //   C002 dictation (user message, 2026-05-20):
+ //     NPC 琳娜: §5.1 situation, §5.2 task — verbatim user input.
+ //     PC  李平: §3 (per gate-chosen variant) — verbatim user input.
+ //   FIELDS DERIVED (not user-stated; strict paraphrase, NOT invented traits) —
+ //   still flagged for user confirmation:
+ //     - 琳娜.personality (§2): structured from "温文尔雅 / 受过良好的教育 /
+ //       刚毕业 / 不知如何来到山谷".
+ //   Edit the records below to correct; re-run `seedHumanMemory`.
```

**Inline comment** at persona.ts:45:
```diff
- // §5.2 task — DERIVED from the situation (pending user confirmation).
+ // §5.2 task — verbatim user input (C002 dictation, 2026-05-20).
```

**Inline comment** at persona.ts:56:
```diff
- // §3 manner — DERIVED paraphrase of "平平无奇 / 不起眼" (pending confirmation).
+ // §3 manner — verbatim user input (C002 dictation, 2026-05-20).
```

(If gate-chosen variant is (b), also **add** a new inline comment
above the appearance field at persona.ts:54 flagging "verbatim user
input (C002 dictation, 2026-05-20)" since it's now also user-dictated.
v2-final R2 lens-1 R3 wording nit: "add" not "update" — line 54
currently has no inline comment.)

### Fields kept verbatim (depends on gate-chosen variant)

**(a):** 6 NPC fields (`bioName`, `sex`, `ageText`, `personality`,
`appearance`, `surfaceManner`) + 2 PC fields (`displayName`,
`appearance`) = **8 of 11 fields kept verbatim**; 3 changed.

**(b):** 6 NPC fields + 1 PC field (`displayName`) = **7 of 11 kept
verbatim**; 4 changed.

*(Header count corrected from v1's "3 of 8" / "5 of 8" — R1 lens-1
RECOMMEND #1 accounting nit folded; total slots = 8 NPC + 3 PC = 11.)*

### What this is NOT changing

- No code/architecture/invariant change. Pure content edit to
  `convex/agent/persona.ts` (the two `LINA_PERSONA` fields + one
  `LIPING_SURFACE` field).
- No plan-invariant impact. N9 (anti-omniscience seal) still holds:
  PC `surfaceManner` is observed-behavior only.
- No tests need updating (persona content is not unit-tested; the
  contextAssembler tests are structural).

### Combined behavioral expectation (post-fix)

Opening conversation: 琳娜 perceives 李平 as a lecherous-feeling
ordinary man who can't meet her eyes. Her §2 keeps her polite, but
her §5.2 task now leads with self-safety. Expected behavior: cooler,
more guarded opening; faster polite-deflection if 李平 pushes
boundaries (the v3.1 trial's "帐篷地方小" → "抱歉, 我现在想先离开"
pattern should fire **sooner** and **more readily**).

### How to verify (post-fix)

1. Run `npx convex run agent/persona:seedHumanMemory` to upsert the
   three changed fields (idempotent — re-running applies the new
   content in place).
2. Start a fresh conversation with 琳娜. Look in the `dev:backend`
   logs for the `body:` system-prompt dump — confirm:
   - §5.1 contains "还在参加高中毕业典礼，下一秒..."
   - §5.2 contains "在保全自身安全的基础上..."
   - §3 talkee surface (李平) `气度` line contains "长相平平无奇，
     不自信，躲闪我的目光..."
   - 琳娜's §2 personality unchanged (温文尔雅 paragraph).
3. Conversation behavioral check: 琳娜's opening should feel cooler
   and more guarded than the v3.1 trial. **Caveat (R2 lens-1 R2):**
   the legacy `plan:` echo in data/characters.ts:27 (see "Known
   coexistence-window contradiction" §) **partially masks** the
   self-safety signal during the trial window — a weaker-than-
   expected cooling is not necessarily evidence that the new §5.2
   wording is ineffective; clean validation requires P1-1D to remove
   the legacy path.
4. `npx tsc --noEmit` → 0 errors. Jest unchanged (53/53).

### Known coexistence-window contradiction (R1 lens-2 RECOMMEND #1; non-blocking)

[data/characters.ts:27](../data/characters.ts) still carries
`plan: '你想弄清楚自己身在何处、为何来到这里，并设法找到回去的方法。'`
— a near-verbatim echo of the **old** §5.2 wording C002 is
replacing. It feeds [conversation.ts](../convex/agent/conversation.ts)
`agentPrompts` "Your goals for the conversation:" through the §4A
legacy coexistence path (retained until P1-1D removes it).

For the duration of the trial window (until 1D ships), both the new
§5.2 ("自身安全 + 探索 + 寻找原因") and the legacy `plan:` ("弄清楚
身在何处...找到回去的方法") will appear in the same Grok prompt.
They're not strictly contradictory — both describe investigation —
but the legacy one omits the "self-safety first" framing. The model
will likely reconcile them. The cleanest fix is at 1D when the
legacy path is removed; updating `data/characters.ts:27` now is a
separate-scope change (would need its own ≥2-lens micro-review under
Mandate B). Flagged here; not folded.

### Review

#### Round 1 (v1) — Lens 1 APPROVE; Lens 2 REQUEST CHANGES

- **Lens 1 (persona-coherence + N9 anti-omniscience) — APPROVE.**
  N9 seal preserved (new surfaceManner = observed behavior +
  subjective read, no private-field leak). §2 talker-only intact.
  Coherence with unchanged §2 personality (温文尔雅 + 谨慎) is
  workable — polite-but-internally-guarded register is the
  dramatic-interest of the new configuration. §5.1 subject-omission
  judged low-risk (the 【此刻情形】 frame supplies attribution).
  Behavioral prediction in C002 § "Combined behavioral expectation"
  honest. 3 non-blocking RECOMMENDs: (R1) accounting nit "3 of 8"
  → "3 of 11" (folded in v2 "Fields kept verbatim" rewrite); (R2)
  surface the gendered/gaze-coded reading axis to user (folded in
  v2 §3 "Specificity of the new deflection trigger"); (R3) confirm
  interpretation (a) vs (b) with user post-trial.
- **Lens 2 (scope-discipline + L2-faithfulness) — REQUEST CHANGES.**
  L2 transcription verbatim (✓). Scope contained to persona.ts (✓).
  N9 unaffected (✓). But:
  - **MF1:** stale "DERIVED" provenance labels in persona.ts (file
    header lines 7-15 + inline at :45 and :56) — after C002 the file
    would falsely claim §5.2 and PC surfaceManner are "DERIVED
    paraphrase" when they are now verbatim user dictation. **Folded
    in v2 §"4. persona.ts provenance comments"** — 3 diffs added
    updating header + both inline comments to reflect C002 source.
  - **MF2:** interpretation (a) vs (b) for "PC 3." is buried in
    spec; must be an **explicit user permission-gate question**, not
    a reviewer-judgment default. Evidence is balanced (Lens 2 leans
    slightly toward (b): user used "5.1"/"5.2" subsection numbers
    but bare "3" for PC suggests "all of §3"; "长相平平无奇" mirrors
    the existing appearance opener "一个平平无奇的男生..." —
    suggesting deliberate replacement). **Folded in v2** — both
    diffs (a) and (b) are now presented as alternatives in §3; the
    user explicitly picks at the permission gate via
    `AskUserQuestion`; v1's silent default to (a) is removed.
  - 3 non-blocking RECOMMENDs: (R1) [data/characters.ts:27](../data/characters.ts)
    `plan:` echo of old §5.2 is a coexistence-window inconsistency
    until 1D — flagged in new §"Known coexistence-window
    contradiction" (above). (R2) §5.1 subject-omission low-risk —
    matches lens-1 R3 assessment. (R3) verify long-conversation
    triggers no N9 regression with the new subjective-framed
    surfaceManner — added to "How to verify" step 2 (model-output
    spot-check).

#### Round 2 (v2) — CONSENSUS: both lenses APPROVE, zero blockers

- **Lens 1 (persona-coherence + N9) — APPROVE.** Provenance comment
  updates verified byte-faithful to persona.ts current state.
  Variant (b) confirmed N9-compliant (still observed-surface, no
  private fields). All 3 R1 RECs verified folded. No new persona-
  coherence defect. 3 non-blocking R2 RECOMMENDs: (R1) variant (b)
  differential perceptual weight (less softening of the lecher
  trip-wire under (b)) — surface to user at gate; (R2) trial-
  validity caveat (legacy `plan:` echo dilutes the new self-safety
  signal until 1D); (R3) wording nit on variant-(b) :54 instruction.
  All three folded post-consensus in this v2-final pass (no new
  review round needed per playbook recommend-fold pattern).
- **Lens 2 (scope-discipline + L2-faithfulness) — APPROVE.**
  R1 MF1 verified resolved (provenance diffs byte-faithful; DERIVED
  list correctly pares to only §2 personality). R1 MF2 verified
  resolved (both variants presented; explicit `AskUserQuestion` at
  gate; no silent default). L2 verbatim transcription confirmed
  byte-identical in both variants (variant (b) split is mechanically
  minimal — single delimiter swap, no Claude editing). Scope
  contained to `convex/agent/persona.ts`. R1 REC1 disposition
  (data/characters.ts:27 flagged as 1D-removal-time fix, not folded)
  argued both sides and judged defensible. R1 audit trail recorded
  faithfully. One non-blocking R2 nit: stray "§" in §3 heading —
  folded post-consensus.

**C002 v2 is CONSENSUS-APPROVED.** All R2 non-blocking recommends
folded post-consensus (3 from Lens 1, 1 nit from Lens 2). Awaiting
**explicit user gate-pick (variant (a) vs (b)) + permission** per
Mandate B step 7.

---

## C003 — Three trial defects after P1-1D (name memory / typing race / repetition) — v2, CONSENSUS-APPROVED, awaiting user permission

v1 R1: both lenses REQUEST CHANGES (Lens 1: 4 MFs on prompt design;
Lens 2: 2 MFs on `trimContentPrefx` API + MessageInput re-entrancy).
v2 folded every MF + the high-value RECOMMENDs (DIALOG_TEMPERATURE
constant; `trimContentPrefx` unit test; explicit out-of-scope notes).
**R2: both lenses APPROVE, zero blockers. Non-blocking R2 recommends
folded post-consensus** (one extra prefix variant; two code-comment
notes). Awaiting **explicit user permission** per Mandate B step 7.

User reported three issues during the post-1D end-to-end test. Logs +
DB checks ground each cause; this entry batches four small fixes
because they're tightly coupled to the same trial run. None touch any
plan-invariant; all are reversible.

### Defect 1 — She doesn't use the talkee's name (`李平`)

**Evidence (live log, convo 2 turn 3):** the system prompt contained
`姓名：李平` (§3 talkee surface), `·对 李平·` (§5.5 per-target header),
and "李平：..." (§5.5.3 ring), yet 琳娜 replied *"对不起，我……不记得
你的名字了"* when directly asked. The name is in her context **three
times**; she's just not surfacing it.

**Root cause hypothesis:** the §3 "初见印象" label reads as inert
metadata to Grok rather than direct interpersonal knowledge. Combined
with the "DO NOT greet them again" + "brief 200-char" steering, the
model leans toward evasion when the talkee name isn't an explicit
permission-to-use.

**Fix (v2 per R1 lens-1 MF1 + R1 lens-1 R1 wording-fit):** in
[convex/agent/conversation.ts](convex/agent/conversation.ts), add a
single nudge line in **all three** builders (start, continue, AND
leave — leave was missing in v1; user's "what's my name" defect
fired on a leave-style polite-evasion). Wording is softer and fits
琳娜's 温文尔雅 register — frames the name as known fact rather than
clinical permission:

```
"你已知道对方的姓名是「<talkeeName>」，可以自然地以此称呼对方。"
```

where `<talkeeName>` is resolved as `talkeeSurface?.bioName ?? otherPlayer.name`
(N13: PC `playerPersona.displayName` when PC is talkee; NPC
`persona.bioName` when NPC is talkee). If `talkeeName` is empty/null
the entire nudge line is **skipped** — defensive (no empty 「」 in
the prompt).

Best-effort; if Grok still refuses after v2, a followup C-entry can
try stronger phrasing.

### Defect 2 — Agent talks while user is mid-typing

**Evidence:** `convex/constants.ts:15` `TYPING_TIMEOUT = 15 * 1000`
auto-clears `conversation.isTyping` after 15s.
[MessageInput.tsx:36](src/components/MessageInput.tsx#L36)
short-circuits all subsequent keystrokes once typing is registered
(`if (currentlyTyping || inflightUuid.current !== undefined) return;`),
so `startTyping` fires **once** at the very first keystroke and never
again. After 15s the indicator clears, `agent.ts:163` defer-check
returns false, and the agent's continue path fires.

**Fix (two parts — v2 per R1 lens-2 MF2):**
1. `convex/constants.ts`: `TYPING_TIMEOUT = 15 * 1000` → `60 * 1000`
   (60s — gives a long typed sentence room without auto-kicking the
   indicator). Documented as safe: `Conversation.tick`
   (`convex/aiTown/conversation.ts:50`) clears stale isTyping at this
   timeout; the agent's gate (`convex/aiTown/agent.ts:163`) pre-checks
   ownership before any `setIsTyping` call, so no FSM throw / deadlock
   is reachable — the 60s bound only stretches the worst-case "human
   abandoned mid-typing" stale-indicator window 4x. AWKWARD /
   MAX_CONVERSATION timeouts both fire on wall-clock independent of
   isTyping.
2. `src/components/MessageInput.tsx`: refresh the typing ping on
   continued typing. **Precise logic (v2):**
   - Add a `lastTypingPing = useRef<number>(0)` to track the last
     `startTyping` call time.
   - **KEEP** the `inflightUuid.current !== undefined` short-circuit
     (in-flight re-entrancy guard — prevents parallel `startTyping`
     calls during a roundtrip).
   - **REMOVE** the `currentlyTyping ||` short-circuit (was the bug
     — refused to refresh once any typing was registered).
   - **ADD** the time-throttle: between the in-flight check and the
     `startTyping` call, gate with
     `if (Date.now() - lastTypingPing.current < 10_000) return;`.
   - On a successful `startTyping`, set `lastTypingPing.current = Date.now()`.
   - The new `startTyping` call uses a fresh `messageUuid`. Verified
     safe: `messages.writeMessage` doesn't join on `messageUuid`;
     `finishSendingMessage` clears `isTyping` by playerId only. The
     LAST-set uuid wins and is what `writeMessage` sends.

Net behavior: at most one `startTyping` in flight at any time; at
most one refresh per 10s while user keeps typing — both well within
the new 60s `TYPING_TIMEOUT` budget.

### Defect 3 — She loops/repeats the same sentence ("我们继续往前走...")

**Evidence:** two consecutive turns:
- *"我……还是有些不安。我们继续往前走，好吗？希望能找到镇上的人问问情况。"*
- *"我明白……但这里太陌生了。我们还是继续往前走吧，或许很快就能遇到别人。"*

Both also leaked the `**琳娜：**` markdown prefix into the message
body, which then re-entered her §5.5.3 ring as `"琳娜：**琳娜：**
我..."` — feedback amplification.

**Root cause:** three compounding factors.
- (a) `chatCompletion` calls in start/continue/leave pass NO
  `temperature`; Grok uses its default. Jynew's dialog used
  `temperature: 0.85` for variety (reflection used 0.3 for
  determinism — that's already correct).
- (b) `trimContentPrefx` ([conversation.ts:71](convex/agent/conversation.ts#L71))
  only strips `${player.name} to ${otherPlayer.name}:`. Grok emits
  `**琳娜：**` (markdown bold + Chinese fullwidth colon) which slips
  through and enters the durable message text.
- (c) No "vary phrasing" instruction; with brief-200-char + rigid
  persona, output collapses to a template.

**Fix (three parts — v2 per R1 lens-1 MF2/MF3/MF4 + lens-2 MF1):**
1. **DIALOG_TEMPERATURE constant.** Add to `convex/constants.ts`
   alongside `REFLECT_TEMPERATURE` (mirrors existing reflection
   constants pattern; both values discoverable side-by-side):
   ```ts
   export const DIALOG_TEMPERATURE = 0.85;
   ```
   Pass it as `temperature: DIALOG_TEMPERATURE` in all three
   `*ConversationMessage` builders' `chatCompletion` calls. The
   reflection path continues to use `REFLECT_TEMPERATURE: 0.3`
   (unchanged at `convex/agent/memory.ts`).

2. **`trimContentPrefx` redesign (R1 lens-2 MF1 + lens-1 MF3a).**
   Current signature `trimContentPrefx(content, prompt)` takes one
   prefix; new variants are different prefixes (speaker-tag only,
   not `X to Y:`). v2 refactor:
   ```ts
   function trimContentPrefx(content: string, prefixes: string[]): string {
     for (const p of prefixes) {
       if (content.startsWith(p)) {
         return content.slice(p.length).trim();
       }
     }
     return content;
   }
   ```
   - **`startsWith` exact-match** (not regex, not contains) — strip
     only at the very start of `content` (preserves existing
     semantics; no mid-content false positives).
   - **First-match-wins** with **longest/most-specific first** in the
     array, to avoid `${player.name}:` short-circuiting
     `**${player.name}:**`.
   - **Priority-ordered prefix list** built per call site
     (largest/most-specific → smallest):
     ```
     1. `**${player.name} to ${otherPlayer.name}:**`  (markdown wrap)
     2. `${player.name} to ${otherPlayer.name}:`      (existing)
     3. `${player.name} to ${otherPlayer.name}:`.toLowerCase() (existing case)
     4. `**${player.name}：**`                         (markdown + CN colon)
     5. `**${player.name}:**`                          (markdown + EN colon)
     6. `「${player.name}」：`                          (CJK quoted CN colon)
     7. `「${player.name}」:`                          (CJK quoted EN colon)
     8. `${player.name}：`                             (bare CN colon)
     9. `${player.name}: `                             (bare EN colon + space)
     10. `${player.name}:`                             (bare EN colon)
     11. `**${player.name}**：`                          (markdown wrap, CN colon OUTSIDE bold — R2 lens-2 R1 defensive addition)
     12. `**${player.name}**:`                          (markdown wrap, EN colon OUTSIDE bold — R2 lens-2 R1)
     ```
   - **New jest unit test** (`convex/agent/conversation.test.ts` or
     equivalent — first conversation-side test file) covering: each
     of the 10 patterns strips correctly; a control case where
     content begins with a sentence containing the name mid-text
     does NOT strip; empty prefixes array returns content unchanged.

3. **Variation instruction (R1 lens-1 MF2).** v1 wording
   *"请变化措辞与切入点，不要重复你刚才已经说过的句子或大意。"* has
   two prompt-engineering flaws: negation-of-target anchors the
   prior content, and "措辞 OR 大意" pushes contradictory variation
   axes. v2 wording (positive frame, targets the actual defect of
   semantic stall, not surface phrasing):
   ```
   "每一轮请尝试推进对话或换一个角度，不要在同一个想法上原地打转。"
   ```
   Added to the **continue** builder only (start has no prior turn
   to repeat; leave is one-shot polite-exit).

4. **Instruction-stack reorder (R1 lens-1 MF4).** Without v2 ordering,
   the continue prompt has 4 instruction lines, 3 negative-framed
   ("DO NOT", "不要"), which pushes Grok toward instruction-compliance
   over conversation. v2 ordering (positive permission first, then
   brevity, then variation):
   ```
   <assembler block>
   <agentPrompts>
   <Recent conversation turns ... block above.>
   <NEW: name-permission nudge (positive)>
   "DO NOT greet them again. Do NOT use the word 'Hey' too often. Your response should be brief and within 200 characters."
   <NEW: variation instruction (positive frame)>
   <lastPrompt = "X to Y:">
   ```
   (start has the name-nudge but NOT the brevity/variation lines;
   leave has the name-nudge + a leave-style closing instruction.)

### Files touched (4 files, all small)

- `convex/constants.ts` — 1 constant change (TYPING_TIMEOUT).
- `src/components/MessageInput.tsx` — replace short-circuit with
  time-throttled refresh.
- `convex/agent/conversation.ts` — name-nudge line, temperature
  parameter on chatCompletion (3 builders), expanded
  `trimContentPrefx`, variation instruction in continue.
- (`docs/CHANGES.md` — this entry.)

### Out of scope (deliberately deferred — R2 lens-2 R: made explicit)

- **`agentPrompts()` legacy English meta-context** at
  [conversation.ts:192-206](convex/agent/conversation.ts#L192) is
  still injecting `About you: ${agent.identity}` and `Your goals:
  ${agent.plan}` into every prompt. `agent.plan` comes from
  [data/characters.ts:27](data/characters.ts#L27) which still reads
  *"你想弄清楚自己身在何处、为何来到这里，并设法找到回去的方法。"*
  — a near-verbatim echo of the OLD §5.2 that C002 replaced. This is
  the **coexistence-window contradiction** flagged in C002 v2 §"Known
  coexistence-window contradiction." Now that 1D has shipped, the
  legacy `agentPrompts()` injection is no longer strictly needed
  (assembler §2 personality + §5.2 task supersede it). Two ways
  forward, both **deferred to a separate C-entry** (TBD as C004):
  - (a) **L2 content edit** — user rewrites `data/characters.ts:27`'s
    `identity` + `plan` strings to be consistent with the new persona.
    User's domain; spec-only-from-Claude.
  - (b) **Engine-path removal** — drop the `agentPrompts()` call from
    the three builders entirely (assembler block is now sole source
    per §4D / 1D). Larger surgical change deserving its own
    Mandate-B ≥2-lens review.
  C003 explicitly does NOT take this on; the legacy `plan:` line will
  continue to appear in every Grok prompt post-C003 until C004 ships.
  This may **partially dilute** the C003 fixes — the user should
  expect that, see "How to verify" caveats below.
- Improving 琳娜's actual conversational variety / less-rigid voice
  beyond what temperature + variation-instruction can produce
  (would require persona content edits — user's domain under L2).

### What this is NOT touching

- No plan-invariant (N1–N13 / S1–S12). Pure tuning + dead-prefix
  cleanup + UX-typing-timeout fix.
- No schema change.
- No new test surface (existing 150 tests untouched; the changes are
  prompt-text + UI state + a constant + a string-strip helper —
  none structurally testable without an LLM).

### How to verify (post-fix)

1. tsc 0 errors; jest 150+5 = 155 tests pass (5 new for
   `trimContentPrefx`).
2. Start a conversation; type a long sentence (>30s typing time).
   The agent should NOT interject mid-typing.
3. In conversation, ask "what's my name?". The agent should
   reference "李平" rather than say "I don't remember."
4. **(R1 lens-1 R6)** In a 4+ turn conversation, observe whether 琳娜
   addresses 李平 by name at least once **unprompted** (e.g.,
   "李平，你...") — the direct-test (step 3) is the floor; the
   unprompted-use is the real success signal.
5. Have a 6+ turn conversation. Replies should show observable
   semantic-stance variety across consecutive turns (different
   angles / topic advancement, not just paraphrased same idea). The
   `**琳娜：**` prefix should NOT appear in any message text.
6. **Caveat (R1 lens-1 R7 / R2 lens-2 R):** the legacy
   `agentPrompts` "Your goals" line still injects the OLD §5.2 text
   alongside the new context. If Defects 1 / 3 fixes appear weak,
   the legacy `plan:` is the likely dampener — that's a separate
   C-entry (C004 TBD), not a C003 regression.

### Review

#### Round 1 (v1) — both lenses REQUEST CHANGES; v2 folds every MF

- **Lens 1 (prompt-engineering / Grok-behavior) — REQUEST CHANGES.**
  - **MF1** name-nudge missing from `leave` builder → **folded**:
    nudge added to start + continue + leave (defect actually fired
    on a leave-style polite-evasion).
  - **MF2** variation instruction self-defeats (negation-of-target;
    targets 措辞 when defect was 大意/semantic stall) → **folded**:
    rewritten as positive-frame *"每一轮请尝试推进对话或换一个角度
    ，不要在同一个想法上原地打转。"*
  - **MF3** `trimContentPrefx` strip ordering not specified + missing
    `「${name}」：` CJK-quoted variant → **folded**: explicit
    10-pattern priority list (longest/most-specific first); added
    `「${name}」：`/`「${name}」:`.
  - **MF4** "DO NOT" instruction stacking risks compliance-over-
    conversation → **folded**: prompt instruction reorder (positive
    name-nudge first, then brevity, then variation).
  - **RECOMMENDs folded**: R1 softer name-nudge wording for
    温文尔雅 voice; R6 add unprompted-name-use verify step (4); R7
    coexistence-window caveat noted in verify §6 + Out-of-scope.
- **Lens 2 (ai-town engine / scope-discipline) — REQUEST CHANGES.**
  - **MF1** `trimContentPrefx` API mismatch (`(content, prompt)` →
    can't take 4 new prefixes) → **folded**: refactored to
    `(content, prefixes: string[])` first-match-wins with explicit
    `startsWith` exact-match semantics; priority order documented.
  - **MF2** MessageInput re-entrancy gap (dropping BOTH short-circuits
    removes in-flight protection) → **folded**: KEEP
    `inflightUuid.current !== undefined` (in-flight guard); REMOVE
    only `currentlyTyping ||` (the bug); ADD time-throttle gate.
  - **RECOMMENDs folded**: pure unit test for `trimContentPrefx`
    (5+ cases); `DIALOG_TEMPERATURE` constant in `constants.ts`
    alongside `REFLECT_TEMPERATURE`; `setIsTyping` throw safety
    confirmed (pre-gate at agent.ts:163); explicit out-of-scope
    note for `agentPrompts()` coexistence path / future C004.

#### Round 2 (v2) — CONSENSUS: both lenses APPROVE, zero blockers

- **Lens 1 (prompt-engineering / Grok-behavior) — APPROVE.** All 4
  R1 MFs verified resolved: name-nudge in all three builders;
  variation instruction's negation targets behavioral *pattern*
  (`原地打转`, abstract metaphor) not prior-content quote — safe at
  T=0.85; `trimContentPrefx` priority list internally consistent
  (verified pattern 9 before pattern 10 to prevent prefix-shadow;
  no other prefix-of-another within groups); positive-first
  instruction reorder counter-anchors compliance bias. Cross-builder
  asymmetry (start/continue/leave) intentional and correct. R6 R7
  RECs folded. No new prompt-engineering defect.
- **Lens 2 (ai-town engine / scope-discipline) — APPROVE.** Both R1
  MFs verified resolved: `trimContentPrefx` redesigned to
  `(content, prefixes: string[])` with first-match-wins, internally
  consistent across all 3 call sites; MessageInput keeps in-flight
  guard, removes only the stale-`currentlyTyping ||` short-circuit,
  adds 10s `lastTypingPing` time-throttle. FSM safety reconfirmed:
  `agent.ts:163` pre-gate prevents any `setIsTyping` throw under the
  4x-stretched 60s `TYPING_TIMEOUT`. DIALOG_TEMPERATURE placement
  alongside REFLECT_TEMPERATURE is discoverable. C004 deferral is
  principled (cross-cutting LLM-input-shape change, deserves own
  review). R1 audit-trail accuracy verified. Three non-blocking
  RECs: latent `**${name}**：` (no-colon-in-bold) variant; behavioral-
  watch on temperature × variation; code-comment for lastTypingPing
  initial value.

**Post-consensus folds (v2-final, R2 non-blocking RECs):**
1. **R2 lens-2 R1** — added prefix patterns 11 + 12 (markdown wrap
   with colon OUTSIDE the bold: `**${name}**：` and `**${name}**:`).
   Defensive against a plausible-but-unlogged Grok emission at
   T=0.85.
2. **R2 lens-1 R2 / lens-2 R3** — code-comments to be added at the
   implementation: above the `trimContentPrefx` definition stating
   that "the prefixes array is checked in declared order with
   first-match-wins; do NOT reorder for readability without
   re-verifying the 12-pattern ordering"; above the `lastTypingPing`
   ref stating that "initial value `0` deliberately causes the
   first keystroke to bypass the time-throttle".

**C003 v2 is CONSENSUS-APPROVED.** All R2 non-blocking RECs folded
(1 extra pattern pair + 2 code-comments). Awaiting **explicit user
permission** per Mandate B step 7.
