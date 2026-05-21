# Instinct Manifest Research — basic-instinct LT seed for 琳娜

**Status:** v1 draft, content-research deliverable for Memory v3.3 §13.3
(phase 2A.0.5). Authored 2026-05-21.

**Scope.** Produces (a) a literature-grounded synthesis on universal
human instincts, (b) an honest evaluation of the user-flagged
"only-available-familiar-male" candidate, (c) a draft
`INSTINCT_MANIFEST` constant of 15 entries, (d) a separate
persona-specific overlay for 琳娜, (e) risks / open Qs, and (f) a
rollout recommendation. **No code touched.** When this doc is
reviewer-approved, its `INSTINCT_MANIFEST` content gets transcribed
into `convex/agent/instincts.ts` and consumed by `seedBasicInstincts`
per Memory v3.3 N28.

**Cross-references.**
- Format & immutability contract: `docs/Memory_KnowledgeDB_Plan.md` §13
  (L23 / N28), `KNOWLEDGE_FACT_MAX_CHARS = 200`.
- Seed-term lexicon every entry's `keywords[]` must overlap with:
  `docs/Action_Decision_Maslow_Plan.md` §4 `PRIORITY_SEED_TERMS`.
- Target NPC frame: `convex/agent/persona.ts` — 琳娜, 18 岁女生, 毕业典礼后
  瞬移到陌生山谷, 不知缘由, 唯一可见的熟人候选是 李平 (一个躲闪目光、
  偷瞄的、自信不足的男性).

---

## §1 Literature synthesis

Twelve grounded findings, ordered roughly by Maslow level they speak
to. Each is the empirical hook for one or more entries in §3.

### F1. Cosmides & Tooby — domain-specific evolved cognitive modules
- **Cite.** Cosmides, L., & Tooby, J. (1997/2013). *Evolutionary
  Psychology: A Primer.* Center for Evolutionary Psychology, UCSB.
  http://www.cep.ucsb.edu/wp-content/uploads/2023/06/Evolutionary-Psychology-A-Primer-CosmidesTooby1993.pdf
- **Summary.** All neurologically normal humans reliably develop a
  standard set of domain-specific reasoning circuits (cheater
  detection, threat appraisal, kin recognition, etc.) tuned to
  recurring ancestral problems. The architecture is universal across
  cultures; what varies is the cultural content fed into it. This
  grounds the very idea of a "basic instinct manifest" — there's a
  small set of cross-cultural reasoning defaults that any human
  persona can be expected to have without learning.

### F2. Drive-reduction theory & homeostatic primary drives
- **Cite.** Hull, C. (1943), as synthesized in Maslow (1943) *A
  Theory of Human Motivation, Psychological Review* 50(4) — classic
  text at https://psychclassics.yorku.ca/Maslow/motivation.htm — and
  the modern primary-motivation review at
  https://psychology.town/motivation-emotion/primary-motivation-drive-self-preservation/
- **Summary.** Hunger, thirst, sleep, thermoregulation, and pain
  avoidance are automatic homeostatic drives — physiological need
  states generate uncomfortable tension that recruits behavior
  oriented at reducing that tension and restoring set point. They
  do not require learning; they are universal across humans
  regardless of culture, age, or sex. These are the cleanest case
  for "universal instinct" content.

### F3. Bowlby — attachment system, safe haven, secure base
- **Cite.** Bowlby, J. *Attachment and Loss* trilogy (1969, 1973,
  1980). Modern overview: Simply Psychology,
  https://www.simplypsychology.org/bowlby.html and Mikulincer & Shaver
  framework summary at
  https://adultattachment.faculty.ucdavis.edu/wp-content/uploads/sites/66/2015/09/Mikulincer_2003_The-attachment-behavioral-system-in-adulthood.pdf
- **Summary.** Humans have an evolved attachment behavioral system
  with two complementary functions: (a) **safe haven** — under
  threat, seek proximity to a familiar attachment figure for
  comfort; (b) **secure base** — when calm, use the attachment
  figure as a launch pad for exploration. The system is universal;
  it operates throughout the lifespan, not just infancy. Critically,
  the attachment figure must be *familiar* — strangers do not
  function as safe havens by default; in fact "fear of strangers"
  is itself an innate component of the system (Bowlby).

### F4. Mikulincer & Shaver — adult attachment, threat-detection module
- **Cite.** Mikulincer, M., & Shaver, P. R. (2003). The attachment
  behavioral system in adulthood. *Advances in Experimental Social
  Psychology* 35, 53–152. PDF as above.
- **Summary.** The adult attachment system has a primary
  threat-monitoring module that continuously scans for danger. When
  a threat is detected, the proximity-seeking module activates and
  the person searches (in reality or mentally) for an attachment
  figure. Secure-base availability mitigates innate stranger-fear
  and fosters more tolerant exploration; absence of an attachment
  figure under threat amplifies vigilance and defensive behavior.
  **Important nuance:** the literature treats *which* figure is
  sought as flexibly conditioned by experience, not specified by
  sex of self or target.

### F5. Taylor — tend-and-befriend as the female stress response
- **Cite.** Taylor, S. E., Klein, L. C., Lewis, B. P., Gruenewald,
  T. L., Gurung, R. A. R., & Updegraff, J. A. (2000). Biobehavioral
  responses to stress in females: Tend-and-befriend, not fight-or-
  flight. *Psychological Review* 107(3), 411–429.
  https://pubmed.ncbi.nlm.nih.gov/10941275/ (APA summary:
  https://www.apa.org/monitor/jan04/habit)
- **Summary.** Under stress, females (across mammals incl. humans)
  show a behavioral pattern oriented toward (a) **tending** —
  protective / nurturant behavior toward offspring and self — and
  (b) **befriending** — recruitment of social network for support.
  Mediated by oxytocin + estrogen. This is proposed as a sex-
  differentiated overlay on the shared sympathetic fight-or-flight
  substrate, not a replacement. **Crucial scope check:** the
  affiliation target in this literature is the *existing social
  network* (other women, kin, established allies), NOT "the nearest
  unfamiliar male." See §2 for why this distinction matters.

### F6. Campbell — "Staying Alive" / female low-risk strategy
- **Cite.** Campbell, A. (1999). Staying alive: Evolution, culture,
  and women's intrasexual aggression. *Behavioral and Brain
  Sciences* 22(2), 203–252.
  https://www.cambridge.org/core/journals/behavioral-and-brain-sciences/article/staying-alive-evolution-culture-and-womens-intrasexual-aggression/2728A6266E77F48243975BD5268B8012
- **Summary.** Because offspring survival depended historically on
  maternal more than paternal presence, females evolved a lower
  threshold for fear in situations of direct bodily threat, and a
  bias toward low-risk self-protective strategies (avoidance,
  indirect aggression) over high-risk confrontational ones. This
  predicts (and converges with crime-victimization data, F7) that
  young women in unfamiliar environments will weight downside risk
  more heavily than young men.

### F7. McLean & Anderson — gender differences in fear & anxiety
- **Cite.** McLean, C. P., & Anderson, E. R. (2009). Brave men and
  timid women? A review of the gender differences in fear and
  anxiety. *Clinical Psychology Review* 29(6), 496–505.
  https://www.sciencedirect.com/science/article/abs/pii/S0272735809000671
- **Summary.** Meta-review confirms women report greater fear and
  are about twice as likely to develop anxiety disorders as men,
  across cultures. Authors note the gap is partly genuine
  (biological + temperament) and partly reporting-bias from male
  gender-role suppression. Reinforces F6 — for an 18yo female
  persona in an unfamiliar setting, elevated threat vigilance and
  affiliation-seeking is empirically the modal response, not a
  stereotype.

### F8. Stranger-danger / fear-of-crime literature (female-specific risk)
- **Cite.** Pain, R. (2000). Place, social relations and the fear
  of crime. *Progress in Human Geography* 24(3), 365–387. Plus:
  Salerno-Ferraro et al. (2022) on TFSV by male strangers,
  https://pmc.ncbi.nlm.nih.gov/articles/PMC9554274/ and the
  general Western Criminology Review survey,
  https://www.westerncriminology.org/documents/WCR/v04n3/article_pdfs/scott.pdf
- **Summary.** Women report substantially higher fear of crime
  than men, driven primarily by fear of sexual assault rather than
  general property crime. The fear is empirically calibrated:
  women are at materially higher risk of sexual victimization by
  unfamiliar males than men are by unfamiliar females. This is
  cross-culturally robust though the magnitude varies. Operative
  implication: an 18yo female persona alone in an unfamiliar place
  should have a strong "wariness toward unfamiliar males
  specifically" instinct — distinct from generic stranger wariness.

### F9. Öhman & Mineka — evolved fear module (snakes, heights, dark)
- **Cite.** Öhman, A., & Mineka, S. (2001/2003). The malicious
  serpent: Snakes as a prototypical stimulus for an evolved module
  of fear. *Current Directions in Psychological Science* 12(1),
  5–9. https://journals.sagepub.com/doi/abs/10.1111/1467-8721.01211
- **Summary.** Humans (and primates) have a specialized,
  evolutionarily prepared fear-learning module preferentially tuned
  to ancestral threats (snakes, spiders, heights, dark/closed
  spaces) — these stimuli are detected pre-attentively and
  conditioned-to faster than equally dangerous modern stimuli (guns,
  electrical outlets). Grounds the "nighttime / darkness raises
  threat sensitivity" instinct.

### F10. Appleton — prospect-refuge theory in environmental psychology
- **Cite.** Appleton, J. (1975). *The Experience of Landscape.*
  Wiley. Modern meta-analysis: Dosen & Ostwald (2016),
  https://link.springer.com/article/10.1186/s40410-016-0033-1
- **Summary.** Humans cross-culturally prefer environments that
  afford both **prospect** (you can see out to scan for resources
  & threats) and **refuge** (you can be concealed / sheltered).
  This pairing predicts environmental preferences in unfamiliar
  settings: people instinctively orient to high-prospect vantage
  points to assess, and to enclosed refuges to wait out
  uncertainty. Direct grounding for the "scan exits and shelterable
  spots first" safety heuristic.

### F11. Baumeister & Leary — the need to belong
- **Cite.** Baumeister, R. F., & Leary, M. R. (1995). The need to
  belong: Desire for interpersonal attachments as a fundamental
  human motivation. *Psychological Bulletin* 117(3), 497–529.
  https://persweb.wabash.edu/facstaff/hortonr/articles%20for%20class/baumeister%20and%20leary.pdf
- **Summary.** The need for frequent, non-aversive interactions
  within ongoing relational bonds is a fundamental human
  motivation — as basic as needs for food and shelter, universal
  across cultures, with measurable cognitive / emotional /
  physical-health consequences when thwarted. Prolonged isolation
  is aversive; reunion / connection is rewarding.

### F12. Williams — ostracism is detected fast and hurts immediately
- **Cite.** Williams, K. D. (2007). Ostracism. *Annual Review of
  Psychology* 58, 425–452. Cyberball foundational paper: Williams,
  Cheung, & Choi (2000). And: Zadro, Williams & Richardson (2004),
  https://www.sciencedirect.com/science/article/abs/pii/S0022103103001823
- **Summary.** Even brief (~2–3 min) ostracism — even when
  ostensibly by a computer — produces strongly negative affect
  and lowered scores on four fundamental needs: belonging,
  self-esteem, control, and meaningful existence. The detection
  is rapid and pre-cognitive. Grounds the "feel lonely / unsettled
  when nobody acknowledges me" instinct under belonging, and the
  "feel diminished when publicly disregarded" instinct under
  esteem.

### F13. Leary — sociometer theory of self-esteem
- **Cite.** Leary, M. R., & Baumeister, R. F. (2000). The nature
  and function of self-esteem: Sociometer theory. *Advances in
  Experimental Social Psychology* 32, 1–62.
- **Summary.** Self-esteem functions as an internal gauge of
  relational value — it tracks the perceived likelihood of being
  accepted vs. rejected by significant others. Self-esteem
  fluctuation is therefore informative, not noise: when people
  are publicly slighted, the gauge drops and motivates corrective
  behavior (repair, withdraw, retaliate). Universal mechanism;
  cultural content of "what counts as a slight" varies.

### F14. Honor / face / dignity culture taxonomy
- **Cite.** Leung, A. K.-Y., & Cohen, D. (2011). Within- and
  between-culture variation: Individual differences and the
  cultural logics of honor, face, and dignity cultures. *Journal
  of Personality and Social Psychology* 100(3), 507–526.
  https://www.academia.edu/9119276/ . See also Smith et al.
  (2021), https://journals.sagepub.com/doi/10.1177/1069397120979571
- **Summary.** East Asian (Chinese) culture is the prototypical
  **face culture** — self-worth is socially conferred and
  preservation of public image (面子) is a primary social
  motivator. Public disrespect produces sharper shame reactions
  than in Western "dignity" cultures, where self-worth is
  internally anchored. This is the appropriate frame for 琳娜's
  esteem-level instincts: she is from a Chinese cultural context,
  so "face" / 不丢脸 instincts are appropriate to overlay.

### F15. Deci & Ryan — self-determination theory (autonomy / competence / relatedness)
- **Cite.** Deci, E. L., & Ryan, R. M. (1985, 2000). *Intrinsic
  Motivation and Self-Determination in Human Behavior.* Plenum.
  Overview: Self-Determination Theory, *Contemporary Educational
  Psychology* 25, 54–67.
  https://www.apa.org/research-practice/conduct-research/self-determination-theory
- **Summary.** Three psychological needs are proposed as
  universal, innate, and necessary for psychological flourishing:
  **autonomy** (acting from one's own values), **competence**
  (feeling effective), **relatedness** (meaningful connection).
  These are operative across cultures (the cultural variation is
  in *how* they're expressed, not whether they exist). Provides
  the grounding for esteem ("competence") and self-actualization
  ("autonomy") instincts.

### F16. Loewenstein — curiosity as information gap; Steger — meaning
- **Cite.** Loewenstein, G. (1994). The psychology of curiosity:
  A review and reinterpretation. *Psychological Bulletin* 116(1),
  75–98. Plus Steger, M. F. (2012). Meaning in life. In *Oxford
  Handbook of Positive Psychology* 2e,
  http://www.michaelfsteger.com/wp-content/uploads/2012/08/Steger-HOPP2-Chapter-in-press.pdf
- **Summary.** Loewenstein: curiosity is a drive-state triggered
  by a perceived gap in one's understanding; resolving the gap is
  intrinsically rewarding. Steger: humans pursue *meaning* —
  comprehension + purpose — as a self-actualization-level driver
  with robust links to well-being. Together: the instinct to
  explore the unfamiliar (especially when displaced into an
  unknown environment) and the instinct to seek a story / reason
  for one's situation are both empirically supported.

---

## §2 Evaluation of the user-flagged candidate

**Candidate (paraphrased).** "For a young female in an unknown
environment, the heuristic to short-term-affiliate with the only-
available-known-male for safety."

**Honest verdict: PARTIAL support — DECOMPOSE into two pieces,
ACCEPT one (universal), REJECT one (folk-myth-shaped) as stated,
and SCOPE the residual to a persona-specific overlay.**

### What the literature DOES support

- **Familiarity-preference under threat (universal, F3 + F4).**
  Bowlby/Mikulincer-Shaver attachment work strongly supports the
  general claim: any human under threat in an unfamiliar
  environment reaches for a *familiar* figure — any familiar
  figure — as a safe haven. The sex of self or target is not
  load-bearing in the core attachment literature.
- **Familiar-vs-stranger is a sharper distinction than male-vs-
  female (F3, F11).** "Known" is the operative variable. A known
  person (any sex) outranks an unknown person (any sex) as a
  proximity target. Even minimal prior interaction shifts a
  person from "stranger" into "weakly familiar" territory
  (Berscheid/Reis familiarity-attraction work).
- **Sex-differentiated risk weighting (F5, F6, F7, F8).**
  Independent of *whom* she affiliates with, the literature
  strongly supports that an 18yo female persona will (a) detect
  ambient threat at lower thresholds than a male peer (F6, F7),
  (b) preferentially adopt tend-and-befriend coping over
  flight/confrontation (F5), and (c) have empirically calibrated
  heightened wariness toward unfamiliar males specifically (F8).
  That last finding cuts AGAINST the user's candidate as stated —
  unfamiliar males are typically a *risk* signal for young women,
  not a safety signal.

### What the literature does NOT support (as stated)

- **"Only-available-MALE as safety target" is folk-script, not
  empirics.** No mainstream evolutionary-psychology,
  attachment-theory, or cross-cultural-psychology source treats
  "nearest available male" as an evolved safety-seeking heuristic
  for females. The closest analog is **mate-guarding / pair-bond
  protection** (Buss-tradition mate selection: cited in 37
  cultures, https://philpapers.org/rec/BUSSDI-2), which is about
  long-term partner choice under non-threat conditions — a
  completely different mechanism. Romance-narrative fiction
  encodes "lone girl + lone guy → he protects her" as a trope;
  the trope is not empirically grounded as an instinct.
- **In fact, the stranger-male-as-threat finding (F8) is the
  opposite signal.** Defaulting an 18yo girl to seek protection
  from an unfamiliar male would model her as having strictly
  weaker situational awareness than the data support.

### Recommendation

1. **Universal manifest (§3): accept the FAMILIARITY-not-SEX
   form.** Encode "seek the nearest familiar / known person for
   short-term safety reference" as a universal instinct — sex-
   neutral, grounded in F3 + F4. This is the genuinely universal
   piece.
2. **Universal manifest (§3): add the SEX-DIFFERENTIATED RISK-
   WEIGHTING piece, but in the wariness direction.** Encode "as
   an 18yo female, unfamiliar males specifically raise my
   wariness" — grounded in F6 + F7 + F8. This is the
   honest-to-the-data female-specific safety instinct.
3. **Persona overlay (§4): the 琳娜-specific "李平 is the only
   familiar-male candidate available" piece.** Whether she
   actually defaults to 李平 for safety is an *application* of
   #1 conditioned on the world state (李平 is the closest thing
   to "known" she has), not an instinct in its own right. We
   capture this as a persona-specific note, NOT as a universal
   instinct row. And the §3 wariness instinct AND the persona's
   §3 observation that 李平 is sneaking glances should both
   surface during recall — leaving the cognitive resolution to
   the Action plan's Op H decision-maker, which is the right
   place for this kind of tradeoff to be resolved.

**Net: the user's intuition that "for a displaced young woman,
there's an instinct to anchor on the nearest familiar figure" is
correct. The intuition that it's sex-keyed toward males is folk
narrative, not science. The encoding below respects both halves.**

---

## §3 Draft `INSTINCT_MANIFEST` constant — 15 entries

Format follows Memory v3 §13.1. All entries: `entity: '__general__'`,
`primaryLevel` indicates the Maslow level Op E-G recall should surface
under. `factText` ≤ 200 chars (verified). Each `keywords[]` includes
≥1 token from `PRIORITY_SEED_TERMS[primaryLevel]` (Action v1.1 §4),
shown in **bold** in the keyword commentary.

**Coverage check vs §13.2 target:** physiological 3, safety 5,
belonging 3, esteem 2, selfActualization 2 — totals 15, within
13–18 band, hits all required minima.

```ts
// docs/Instinct_Manifest_Research.md §3 — DRAFT for Memory v3.3 §13 / N28.
// To be transcribed into convex/agent/instincts.ts when reviewer-approved.
// All entries get source: 'instinct', pinned: true, tier: 'LT', importance: 5,
// frequency: 1, affectImpact: null (per N28) when seeded.

export const INSTINCT_MANIFEST: InstinctSeed[] = [

  // ─── Physiological (3) ─────────────────────────────────────────────
  // I-PHY-1 — homeostatic hunger drive (F2: drive-reduction / Maslow 1943).
  {
    primaryLevel: 'physiological',
    factText: '饿了就要找吃的，太久不吃东西身体会发软、注意力会涣散。',
    keywords: [
      { keyword: '饥', assocRatio: 0.95 },   // ★ seed
      { keyword: '食', assocRatio: 0.85 },   // ★ seed
      { keyword: '身体', assocRatio: 0.4 },
    ],
    entity: '__general__',
  },

  // I-PHY-2 — thermoregulation + thirst (F2).
  {
    primaryLevel: 'physiological',
    factText: '冷了要找地方避寒、添衣或取暖；渴了要找水，否则身体会越来越不舒服。',
    keywords: [
      { keyword: '冷', assocRatio: 0.9 },    // ★ seed
      { keyword: '渴', assocRatio: 0.9 },    // ★ seed
      { keyword: '热', assocRatio: 0.6 },    // ★ seed (mirror)
    ],
    entity: '__general__',
  },

  // I-PHY-3 — sleep / fatigue (F2: primary drive).
  {
    primaryLevel: 'physiological',
    factText: '极度疲倦时身体会自行慢下来，判断力也会变差；该睡就得睡，硬撑会出事。',
    keywords: [
      { keyword: '累', assocRatio: 0.9 },    // ★ seed
      { keyword: '困', assocRatio: 0.9 },    // ★ seed
      { keyword: '睡', assocRatio: 0.85 },   // ★ seed
    ],
    entity: '__general__',
  },

  // ─── Safety (5) ────────────────────────────────────────────────────
  // I-SAF-1 — prospect-refuge: scan exits & shelterable spots first (F10).
  {
    primaryLevel: 'safety',
    factText: '到了陌生地方，本能上先看清出入口、能藏身或退避的位置，再决定走动。',
    keywords: [
      { keyword: '陌生', assocRatio: 0.9 },  // ★ seed
      { keyword: '安全', assocRatio: 0.7 },  // ★ seed
      { keyword: '警惕', assocRatio: 0.6 },  // ★ seed
      { keyword: '逃', assocRatio: 0.5 },    // ★ seed
    ],
    entity: '__general__',
  },

  // I-SAF-2 — attachment safe-haven: seek the nearest KNOWN figure under threat
  //           (F3 + F4; sex-neutral form per §2 verdict).
  {
    primaryLevel: 'safety',
    factText: '心里发慌时，本能会想靠近自己认识或熟悉的人；陌生人再多也不如一个熟人让人安心。',
    keywords: [
      { keyword: '不安', assocRatio: 0.85 }, // ★ seed
      { keyword: '信任', assocRatio: 0.7 },  // ★ seed
      { keyword: '陌生', assocRatio: 0.6 },  // ★ seed
      { keyword: '熟人', assocRatio: 0.8 },
    ],
    entity: '__general__',
  },

  // I-SAF-3 — sex-differentiated wariness toward unfamiliar males
  //           (F6 + F7 + F8 — §2 verdict: this is the empirically honest
  //           female-specific safety instinct; replaces the user's
  //           "rely on lone male" candidate with what the data actually shows).
  {
    primaryLevel: 'safety',
    factText: '作为年轻女生，独处时遇到不认识的男性会本能提高警惕；眼神、距离、动作都先留意。',
    keywords: [
      { keyword: '陌生', assocRatio: 0.8 },  // ★ seed
      { keyword: '警惕', assocRatio: 0.85 }, // ★ seed
      { keyword: '威胁', assocRatio: 0.5 },  // ★ seed
      { keyword: '紧张', assocRatio: 0.55 }, // ★ seed
    ],
    entity: '__general__',
  },

  // I-SAF-4 — evolved fear module: night / dark / closed space raises threat
  //           sensitivity (F9 Öhman & Mineka; prepared-fear stimuli).
  {
    primaryLevel: 'safety',
    factText: '天黑、视线不清、独处一处时，本能上的不安会比白日更甚，对声响也更敏感。',
    keywords: [
      { keyword: '惧', assocRatio: 0.8 },    // ★ seed
      { keyword: '不安', assocRatio: 0.75 }, // ★ seed
      { keyword: '警惕', assocRatio: 0.7 },  // ★ seed
      { keyword: '险', assocRatio: 0.55 },   // ★ seed
    ],
    entity: '__general__',
  },

  // I-SAF-5 — keep an exit / don't accept being cornered (F4 threat module +
  //           F10 prospect-refuge applied to social space).
  {
    primaryLevel: 'safety',
    factText: '不熟的人靠得太近、或被堵在没退路的角落时，本能会想拉开距离或换位置。',
    keywords: [
      { keyword: '紧张', assocRatio: 0.8 },  // ★ seed
      { keyword: '逃', assocRatio: 0.7 },    // ★ seed
      { keyword: '险', assocRatio: 0.5 },    // ★ seed
      { keyword: '距离', assocRatio: 0.8 },
    ],
    entity: '__general__',
  },

  // ─── Belonging (3) ─────────────────────────────────────────────────
  // I-BEL-1 — need to belong: prolonged isolation is aversive (F11).
  {
    primaryLevel: 'belonging',
    factText: '太长时间没有人愿意和我说话或留意我，心里会渐渐空落、不踏实。',
    keywords: [
      { keyword: '孤独', assocRatio: 0.9 },  // ★ seed
      { keyword: '陪伴', assocRatio: 0.7 },  // ★ seed
      { keyword: '联系', assocRatio: 0.55 }, // ★ seed
    ],
    entity: '__general__',
  },

  // I-BEL-2 — felt understanding generates closeness (F11 + Reis intimacy work).
  {
    primaryLevel: 'belonging',
    factText: '当一个人真正听懂我说的话、回应得恰当，我会本能地对他多一分亲近。',
    keywords: [
      { keyword: '理解', assocRatio: 0.9 },  // ★ seed
      { keyword: '亲近', assocRatio: 0.85 }, // ★ seed
      { keyword: '温暖', assocRatio: 0.5 },  // ★ seed
    ],
    entity: '__general__',
  },

  // I-BEL-3 — ostracism / being ignored hurts fast (F12 Williams).
  {
    primaryLevel: 'belonging',
    factText: '在场的人有说有笑却唯独不理我，哪怕时间不长，心里也会很快不是滋味。',
    keywords: [
      { keyword: '孤独', assocRatio: 0.8 },  // ★ seed
      { keyword: '认同', assocRatio: 0.6 },  // ★ seed
      { keyword: '关心', assocRatio: 0.5 },  // ★ seed
    ],
    entity: '__general__',
  },

  // ─── Esteem (2) ────────────────────────────────────────────────────
  // I-EST-1 — sociometer: public disrespect drops self-evaluation,
  //           motivates repair/withdraw/push-back (F13 Leary, F14 face culture).
  {
    primaryLevel: 'esteem',
    factText: '当众被人贬低或嘲笑，本能上会想反驳、回避或离开现场，不愿就这样被定下来。',
    keywords: [
      { keyword: '羞愧', assocRatio: 0.8 },  // ★ seed
      { keyword: '自尊', assocRatio: 0.85 }, // ★ seed
      { keyword: '面子', assocRatio: 0.7 },  // ★ seed (face-culture per F14)
      { keyword: '评价', assocRatio: 0.55 }, // ★ seed
    ],
    entity: '__general__',
  },

  // I-EST-2 — competence-recognition is rewarding; reciprocity follows
  //           (F15 SDT competence; F13 sociometer positive side).
  {
    primaryLevel: 'esteem',
    factText: '被人合理地认可、看见我做得到的事，会让我愿意多付出一点，也会更自在。',
    keywords: [
      { keyword: '被认可', assocRatio: 0.9 },// ★ seed
      { keyword: '被看见', assocRatio: 0.8 },// ★ seed
      { keyword: '能力', assocRatio: 0.7 },  // ★ seed
      { keyword: '尊重', assocRatio: 0.6 },  // ★ seed
    ],
    entity: '__general__',
  },

  // ─── Self-actualization (2) ────────────────────────────────────────
  // I-SA-1 — curiosity / exploration drive (F16 Loewenstein info-gap;
  //          F15 SDT autonomy).
  {
    primaryLevel: 'selfActualization',
    factText: '没见过的事物、想不通的情形会牵着我去看一看、问一问，弄明白本身就让我心里舒服。',
    keywords: [
      { keyword: '探索', assocRatio: 0.9 },  // ★ seed
      { keyword: '兴趣', assocRatio: 0.75 }, // ★ seed
      { keyword: '意义', assocRatio: 0.5 },  // ★ seed
    ],
    entity: '__general__',
  },

  // I-SA-2 — meaning-seeking: I want a coherent story for why I'm here
  //          (F16 Steger meaning-in-life).
  {
    primaryLevel: 'selfActualization',
    factText: '若一件事我自己都说不出意义在哪里，长此以往会觉得空；做事最好能让我感到有所目的。',
    keywords: [
      { keyword: '意义', assocRatio: 0.9 },  // ★ seed
      { keyword: '目标', assocRatio: 0.8 },  // ★ seed
      { keyword: '价值', assocRatio: 0.7 },  // ★ seed
    ],
    entity: '__general__',
  },
];
```

**Keyword-overlap audit (Action v1.1 §4 PRIORITY_SEED_TERMS):**
every entry above has ≥1 (most have 3–4) keywords that appear
verbatim in the corresponding level's seed-term list. Op E-G's
deterministic recall will surface these under the matching priority.
Spot-checks:
- I-PHY-1: 饥 ✅ 食 ✅ (both in physiological seed list)
- I-SAF-3: 陌生 ✅ 警惕 ✅ 威胁 ✅ 紧张 ✅ (all four in safety seed)
- I-BEL-2: 理解 ✅ 亲近 ✅ 温暖 ✅ (all three in belonging seed)
- I-EST-1: 羞愧 ✅ 自尊 ✅ 面子 ✅ 评价 ✅ (all four in esteem seed)
- I-SA-2: 意义 ✅ 目标 ✅ 价值 ✅ (all three in selfActual seed)

**Character-count audit (KNOWLEDGE_FACT_MAX_CHARS = 200):** longest
entry is I-SAF-5 at ~36 chars; all entries comfortably under cap.

---

## §4 Persona-specific overlay for 琳娜

The universal manifest above is culture-neutral and sex-aware only
in the empirically-defensible direction (I-SAF-3 = elevated
wariness, not affiliation). This overlay adds 琳娜-specific instinct
content grounded in (a) her cultural context — Chinese, F14 face
culture — and (b) her specific situational frame — abruptly
displaced from a high-school graduation into an unknown valley.
These are **persona-overlay** rows; if Q13 (per-persona instincts)
is eventually approved, they merge into INSTINCT_MANIFEST scoped by
persona. Until then, they can ship by extending `seedBasicInstincts`
to take a `personaName` parameter that conditionally adds these.

```ts
// 琳娜-specific overlay. Same row shape as INSTINCT_MANIFEST; seed only
// when persona.bioName === '琳娜'. Grounding: F14 face-culture +
// situational context per convex/agent/persona.ts.

export const LINA_OVERLAY: InstinctSeed[] = [

  // O-LINA-1 — Chinese face-culture overlay on esteem (F14).
  // Sharpens the universal I-EST-1 sociometer instinct with the
  // face-culture salience of public composure.
  {
    primaryLevel: 'esteem',
    factText: '我从小被教导言行要得体，当众失态或被人轻看会让我心里很不是滋味；保持体面是本能。',
    keywords: [
      { keyword: '面子', assocRatio: 0.95 }, // ★ seed
      { keyword: '羞愧', assocRatio: 0.7 },  // ★ seed
      { keyword: '评价', assocRatio: 0.7 },  // ★ seed
      { keyword: '骄傲', assocRatio: 0.4 },  // ★ seed
    ],
    entity: '__general__',
  },

  // O-LINA-2 — situational meaning-seeking specific to her displacement
  //            (F16 Steger; conditioned on persona.defaultTask).
  // Note: this is NOT a generic "curiosity" row (covered by I-SA-1) —
  // it's the persistent "I need to find out HOW I got here" pull that
  // her current defaultTask gives her, encoded as an instinct so it
  // re-surfaces even after the immediate task field decays.
  {
    primaryLevel: 'selfActualization',
    factText: '我莫名其妙出现在这里，弄明白自己为何到此、能否回去，是我心里压不住的念头。',
    keywords: [
      { keyword: '意义', assocRatio: 0.7 },  // ★ seed
      { keyword: '探索', assocRatio: 0.8 },  // ★ seed
      { keyword: '目标', assocRatio: 0.85 }, // ★ seed
      { keyword: '使命', assocRatio: 0.5 },  // ★ seed
    ],
    entity: '__general__',
  },

  // O-LINA-3 — gentle/courteous demeanor as her DEFAULT social posture
  //            (derived from persona.personality '温文尔雅 / 彬彬有礼').
  // This is a borderline case — arguably it's a personality trait
  // (already in §2 self) rather than an instinct. Including as overlay
  // so that under threat, she still RECOGNIZES rude / coarse behavior
  // as a violation of her expectations rather than baseline.
  {
    primaryLevel: 'belonging',
    factText: '我习惯了用客气、温和的方式与人相处；粗鲁、过分直接的言行让我不适，也让我对那人更警觉。',
    keywords: [
      { keyword: '理解', assocRatio: 0.5 },  // ★ seed (belonging)
      { keyword: '陌生', assocRatio: 0.6 },  // ★ seed (safety crossover)
      { keyword: '警惕', assocRatio: 0.55 }, // ★ seed (safety crossover)
      { keyword: '不安', assocRatio: 0.5 },  // ★ seed (safety crossover)
    ],
    entity: '__general__',
  },
];
```

**Note on the user-flagged "rely on 李平" piece.** Per §2, this is
NOT encoded as an instinct here. The cognitive path that would
make her gravitate toward 李平 is the *application* of universal
instinct I-SAF-2 (seek nearest familiar) to the specific world
state where 李平 is the only weakly-familiar candidate available.
That application is the right thing for Op H's action LLM to
resolve at decision time, weighed against I-SAF-3 (unfamiliar-male
wariness) and the persona's perception of his sneak-glance
behavior (from `playerPersona.surfaceManner`). Encoding it as a
hard instinct would over-determine her behavior in a direction the
literature doesn't support.

---

## §5 Risks / open questions

- **R1 — I-SAF-3 sex-keying is the strongest claim made here.**
  The "elevated wariness toward unfamiliar males specifically" row
  is empirically defensible (F6, F7, F8) but ideologically
  contested. Reviewers who lean essentialist may want it stronger;
  reviewers who lean constructivist may want it scoped to persona
  overlay rather than universal. I have placed it in the universal
  manifest because the cross-cultural crime-victimization data
  (F8) is robust and the entry text is honest — it says "本能提高
  警惕," not "对方一定是威胁." If the user disagrees, demote to
  persona overlay; the row stays usable.

- **R2 — Overlap with personality / persona text.** O-LINA-3
  (gentle demeanor) is on the boundary between "personality" (in
  `persona.personality`, §2 talker-only) and "instinct" (in
  `knowledgeFact`, §6 renderable). I argued for including it as
  an instinct because §2 personality is consumed only at LLM-
  prompt assembly time as a static description, while
  `knowledgeFact` rows participate in Op E-G's recall scoring and
  thus shape *which* memories surface in a given moment.
  Reviewers may push back; if so, drop O-LINA-3 and rely on §2
  personality alone.

- **R3 — Affect-impact left null per N28.** All instinct rows
  carry `affectImpact: null` because N28 mandates it ("instincts
  carry no inherent affect — they are procedural, not episodic").
  This is correct, but means that recalling I-SAF-3 (e.g.) does
  NOT directly boost emotion intensity. The boost path is
  indirect: surfacing I-SAF-3 in the recall list raises the
  action-LLM's framing toward caution, which then produces an
  emotion update via Op A on her next turn. Verify this two-step
  works as expected in 2A.1 trials; if not, the contract may need
  revisiting.

- **R4 — Keyword-list cap interaction.** Entries here have 3–4
  keywords. Memory v3 sets `KNOWLEDGE_FACT_MAX_KEYWORDS = 8`. We
  have headroom, but if L7 refresh ever copies an instinct into
  ST and Op A merges new keywords from a related episode, the
  merged copy might bump against the cap. Per N28 the original
  LT instinct stays canonical, so this is bounded — flagging for
  awareness only.

- **R5 — I deliberately did NOT seed a "money / resources" row.**
  Maslow's Stage 1 includes basic resource concerns, and Buss F-
  ish literature would justify an "ensure resources for tomorrow"
  instinct. I omitted because (a) it's not in §13.2's required
  categories, (b) for an 18yo girl who just arrived from a
  graduation ceremony, immediate resource-acquisition isn't the
  bedrock instinct her situation calls for, and (c) the entry
  count is at 15 with all required minima met. Flagging in case
  reviewers want a 16th physiological-leaning safety row.

- **R6 — Cultural context of the manifest.** Universal manifest
  uses culture-neutral Chinese text; persona overlay (O-LINA-1)
  adds Chinese face-culture coloring. If later personas are non-
  Chinese (e.g., a Western character), O-LINA-1 should NOT be
  copied to them — the overlay design assumes per-persona scoping
  is added when Q13 lands.

- **R7 — The §2 verdict on the user-flagged candidate is a
  judgment call.** Reasonable reviewers might decompose it
  differently (e.g., encode it directly as a 琳娜-overlay
  instinct with "in this specific situation 李平 is my only
  candidate"). I chose against because hard-coding "her instinct
  is to rely on 李平" preempts the very interpersonal-dynamics
  question the trial is trying to observe. If the trial finds
  she's TOO wary and never affiliates, the right fix is to
  re-weight I-SAF-2 vs I-SAF-3 in keyword `assocRatio`s, not to
  add a "trust the male" row.

---

## §6 Open recommendation — rollout (all-at-once vs incremental per level)

**Recommendation: ship all 15 universal entries + 3 persona-overlay
entries in one drop, but enable them behind a per-LEVEL feature
flag at the `seedBasicInstincts` call site.**

Reasoning:

- **Against pure "all at once."** Memory v3.3 §13 explicitly lists
  this as deferred research; shipping 15 entries without per-level
  observability makes trial-side debugging hard ("the NPC is
  acting weird — which of the 15 instincts is causing it?").
- **Against pure "incremental per level."** Cognition is
  inter-level: I-SAF-2 (seek familiar) and I-SAF-3 (wary of
  unfamiliar male) and O-LINA-3 (gentle demeanor) all interact in
  any single moment 琳娜 sees 李平. Shipping only physiological
  first would produce uninteresting trial output and not exercise
  the interactions the manifest exists for.
- **Compromise: ship-all-with-flag.** `seedBasicInstincts(ctx, {
  levels: 'all' | Set<MaslowLevel> })` defaults to `'all'` in
  production but the trial harness can pass a subset to ablate.
  This gives full coverage at default and per-level isolation when
  debugging — best of both. Adds ~5 lines of code at the seed
  function, no schema impact.

**Implementation hint** (not for this doc, but for whoever
transcribes into `convex/agent/instincts.ts`): the InstinctSeed
records here are already grouped by `primaryLevel` so the flag
filter is a one-line `.filter(r => levels === 'all' || levels.has(r.primaryLevel))`.

---

**End of research deliverable.** Next gate: reviewer pass on §2 +
§3, then phase 2A.0.5 implementation transcribes §3 + §4 into
`convex/agent/instincts.ts`.
