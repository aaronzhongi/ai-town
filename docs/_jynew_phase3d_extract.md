Excellent! Now I have all the critical files. Let me compile a comprehensive extraction report:

---

# PHASE 3D LAYERED MEMORY IMPLEMENTATION EXTRACTION

## EXECUTIVE SUMMARY

The jynew AITavern Phase 3D memory system implements a human-like episodic-to-semantic consolidation pipeline. It uses:

1. **RuntimeMindState** - per-NPC volatile short-term memory (situation, task, surroundings, emotion, per-target affection, global reflection)
2. **EpisodicRing** - FIFO buffer (10 slots: pinned anchor + 9 recent turns) with mid-conversation overflow spill
3. **MemoryCompactor** - reflection-consolidation op converting raw episodic transcripts into durable per-pair summaries + affect deltas via 4-slot Grok prompt
4. **ContextAssembler** - deterministic prompt builder (§1-§5 layered sections, no Grok)
5. **AffectBaseline** - RelationType-to-scalar baseline mapping for affection decay
6. **CharacterBio / CharacterDossier** - extended schema (persona + surface + long-term knowledge)
7. **GrokClient** - xAI Grok HTTP client (temperature/tokens tuned per use)
8. **Constants** - decay half-lives, ring cap, salience deadband, section budgets

---

## DETAILED TYPE/CLASS DEFINITIONS & ALGORITHMS

### 1. RuntimeMindState.cs (Complete)

**Full class hierarchy** (RuntimeMindState.cs:1-82):

```csharp
public class RuntimeMindState
{
    public GameId Owner;
    public string Situation;                                         // §5.1
    public string Task;                                              // §5.2
    public SurroundingsModel Surroundings = new SurroundingsModel(); // §5.3
    public Affect Emotion;                                           // §5.4
    public Dictionary<GameId, TargetState> Targets = new Dictionary<GameId, TargetState>(); // §5.5
    public string GlobalReflection;                                  // §5.0
}

public class SurroundingsModel
{
    public string PlaceText;
    public List<string> KnownPresent = new List<string>();
    public string Summary;
    public long LastUpdatedMs;
}

public class Affect
{
    public string Label;
    public float  Value;        // emotion: 0..1; affection: -1..1
    public float  Baseline;     // emotion → 0; affection → canon baseline
    public long   LastSetMs;
    public float  HalfLifeMs;

    // DECAY ALGORITHM (RuntimeMindState.cs:51-56):
    public float Current(long now)
    {
        if (HalfLifeMs <= 0f) return Value;          // guard
        double dt = now - LastSetMs;                  // long-long → double
        return (float)(Baseline + (Value - Baseline) * System.Math.Exp(-dt / HalfLifeMs));
    }
    // Formula: A(t) = Baseline + (Value₀ - Baseline) × exp(-t / τ)
    // where τ = HalfLifeMs, t = elapsed time.
}

public class TurnRecord
{
    public GameId Speaker;
    public string Text;
    public long   Ms;
}

public class TargetState
{
    public Affect Affection;                 // §5.5.1
    public string ReflectionSummary;         // §5.5.2
    public List<TurnRecord> Ring = new List<TurnRecord>();  // §5.5.3
    public string ImpressionDelta;           // §4 overlay
}
```

**Key Invariants:**
- `Affect.Current(now)` is **lazy** — computed on read, no per-frame tick.
- Emotion baseline = 0 (decays toward calm); affection baseline = canon RelationType scalar.
- `Emotion.Label` ∈ {平静/警惕/愤怒/喜悦/恐惧…}; affection has optional short label.

---

### 2. EpisodicRing.cs (Complete)

**Static helper: Record()** (EpisodicRing.cs:28-102):

```csharp
public static void Record(AITavernManager mgr, Conversation conv,
                          GameId speaker, string text, long ms)
{
    // Guards: never throw into turn path.
    if (mgr == null || conv == null || mgr.NPCs == null) return;
    if (conv.Participants == null) return;
    if (string.IsNullOrWhiteSpace(text)) return;

    foreach (var kv in conv.Participants)
    {
        GameId owner = kv.Key;
        var a = mgr.NPCs.Get(owner);
        if (a == null || a.IsHuman) continue;  // Skip player (no mind)

        // Find talkee = the OTHER participant (2-party).
        GameId talkee = default;
        bool foundTalkee = false;
        foreach (var other in conv.Participants.Keys)
        {
            if (!other.Equals(owner)) { talkee = other; foundTalkee = true; break; }
        }
        if (!foundTalkee) continue;

        // Get or create mind/target.
        var mind = mgr.GetOrCreateMind(owner);
        if (mind.Targets == null)
            mind.Targets = new System.Collections.Generic.Dictionary<GameId, TargetState>();
        if (!mind.Targets.TryGetValue(talkee, out var ts) || ts == null)
        {
            ts = new TargetState();
            mind.Targets[talkee] = ts;
        }
        if (ts.Ring == null)
            ts.Ring = new System.Collections.Generic.List<TurnRecord>();

        // APPEND TURN.
        ts.Ring.Add(new TurnRecord { Speaker = speaker, Text = text, Ms = ms });

        // ANCHOR + LAST-9 CAP with EVICTION (EpisodicRing.cs:84-95):
        if (ts.Ring.Count > AITavernConstants.MEMORY_RING_CAP)
        {
            var evicted = ts.Ring[1];          // oldest NON-anchor (Ring[0] pinned)
            SpillEvicted(mgr, owner, talkee, evicted);
            ts.Ring.RemoveAt(1);               // Remove at index 1 (NOT 0)
        }
    }
}

// SPILL TO MEMORY (EpisodicRing.cs:113-118):
static void SpillEvicted(AITavernManager mgr, GameId owner, GameId talkee, TurnRecord evicted)
{
    if (mgr == null || mgr.Memory == null || evicted == null) return;
    string body = "[spill] " + (evicted.Speaker.Value ?? "?") + ": " + (evicted.Text ?? string.Empty);
    mgr.Memory.AppendConversationMemory(owner, talkee, body, evicted.Ms);
}
```

**Critical invariants:**
- Ring[0] = **pinned anchor** (first turn, never evicted by cap alone).
- 11th turn → evict Ring[1] (oldest NON-anchor) → spill to MemoryStash.
- Spill marked `[spill]` so reflection can detect mid-conversation overflow vs. post-conv full transcript.
- Called **synchronously AFTER** `conv.AddMessage` at every turn-write site (co-location invariant §5.1).
- Player has no mind — skipped as ring owner but valid talkee.

---

### 3. MemoryCompactor.cs (Complete Extraction)

#### **ConsolidateForOwner() — T3D.3** (MemoryCompactor.cs:66-303)

Full algorithm with all parsing and affect delta logic:

```csharp
public static async UniTask<bool> ConsolidateForOwner(
    AITavernManager mgr, GameId owner, GameId other, long now)
{
    if (mgr == null || mgr.Memory == null) return false;

    // ---- STEP 2: Collect raw (re-fold-from-raw discipline, Phase 2) ----
    // Spill turns (mid-conversation evictions) + raw MemoryEntry list (post-conv full transcripts).
    // Prior ReflectionSummary is DELIBERATELY EXCLUDED (anti-degradation).
    var rawSpill = new List<MemoryEntry>();
    foreach (var e in mgr.Memory.ForOwner(owner))
    {
        if (e.Type != MemoryType.Conversation) continue;
        if (!e.Target.HasValue) continue;
        if (!e.Target.Value.Equals(other)) continue;
        if (e.IsFolded) continue;                    // Skip already-folded
        rawSpill.Add(e);
    }
    rawSpill.Sort((a, b) => a.EndedAt.CompareTo(b.EndedAt));  // oldest-first

    // Surviving ring (not yet spilled).
    var mind = mgr.GetOrCreateMind(owner);
    if (mind.Targets == null)
        mind.Targets = new Dictionary<GameId, TargetState>();
    if (!mind.Targets.TryGetValue(other, out var ts) || ts == null)
    {
        ts = new TargetState();
        mind.Targets[other] = ts;
    }
    if (ts.Ring == null) ts.Ring = new List<TurnRecord>();

    // ---- Build raw concatenation (oldest-first): spill, then ring ----
    var rawBody = new StringBuilder(1024);
    int rawPieces = 0;
    foreach (var e in rawSpill)
    {
        if (string.IsNullOrWhiteSpace(e.Description)) continue;
        if (rawPieces > 0) rawBody.Append('\n');
        rawBody.Append(e.Description.Trim());
        rawPieces++;
    }
    foreach (var tr in ts.Ring)
    {
        if (tr == null || string.IsNullOrWhiteSpace(tr.Text)) continue;
        if (rawPieces > 0) rawBody.Append('\n');
        rawBody.Append(tr.Speaker.Value ?? "?").Append(": ").Append(tr.Text.Trim());
        rawPieces++;
    }

    if (rawPieces == 0) return false;  // Nothing to consolidate

    // ---- STEP 3: The §5.3 4-slot Grok call ----
    string systemPrompt = BuildReflectSystemPrompt();
    string userBody = BuildReflectUserBody(mgr, owner, other, rawBody.ToString());

    string raw;
    try
    {
        if (mgr.Grok == null)
        {
            Debug.LogWarning(
                $"[Reflect] no Grok client wired; skipping consolidation for owner={owner}");
            return false;
        }
        raw = await mgr.Grok.CompleteChatAsync(
            systemPrompt,
            new List<(string, string)> { ("user", userBody) },
            maxTokens: AITavernConstants.REFLECT_MAX_TOKENS,    // 500
            stopSequences: new[] { "User:", "Assistant:" },
            temperature: AITavernConstants.REFLECT_TEMPERATURE); // 0.3f
    }
    catch (Exception ex)
    {
        Debug.LogWarning(
            $"[Reflect] grok failed for owner={owner} other={other}: {ex.Message}");
        return false;  // Ring + spill left intact for retry
    }

    string text = raw != null ? raw.Trim() : null;
    if (string.IsNullOrWhiteSpace(text))
    {
        Debug.LogWarning($"[Reflect] empty response for owner={owner} other={other}");
        return false;
    }

    // ---- STEP 4: Parse 4 slots ----
    const string SLOT_IMPRESSION    = "往来印象：";
    const string SLOT_EMOTION       = "情绪变化：";
    const string SLOT_AFFECTION     = "好恶变化：";
    const string SLOT_CONTRADICTION = "违背设定：";

    string summaryText  = ExtractSlot(text, SLOT_IMPRESSION);
    string emotionRaw   = ExtractSlot(text, SLOT_EMOTION);
    string affectionRaw = ExtractSlot(text, SLOT_AFFECTION);
    string contradiction = ExtractSlot(text, SLOT_CONTRADICTION);

    if (string.IsNullOrWhiteSpace(summaryText))
    {
        string head = text.Length > 80 ? text.Substring(0, 80) : text;
        Debug.LogWarning(
            $"[Reflect] 往来印象 slot missing owner={owner} other={other}; raw={head}");
        return false;
    }
    summaryText = summaryText.Trim();

    ParseEmotion(emotionRaw, out string emotionLabel, out float emotionIntensity,
                 out bool emotionNeutral);
    float affDelta = ParseAffectionDelta(affectionRaw);
    bool hasContradiction = HasContradiction(contradiction);

    // ---- STEP 5: Write durable summary ----
    ts.ReflectionSummary = summaryText;

    long coveredFromMs = long.MaxValue, coveredUntilMs = long.MinValue;
    int foldedEntryCount = 0;
    foreach (var e in rawSpill)
    {
        foldedEntryCount++;
        if (e.EndedAt < coveredFromMs) coveredFromMs = e.EndedAt;
        if (e.EndedAt > coveredUntilMs) coveredUntilMs = e.EndedAt;
    }
    foreach (var tr in ts.Ring)
    {
        if (tr == null) continue;
        if (tr.Ms < coveredFromMs) coveredFromMs = tr.Ms;
        if (tr.Ms > coveredUntilMs) coveredUntilMs = tr.Ms;
    }
    if (coveredFromMs == long.MaxValue) { coveredFromMs = now; coveredUntilMs = now; }

    GameId ownerA, ownerB;
    if (string.CompareOrdinal(owner.Value, other.Value) <= 0) { ownerA = owner; ownerB = other; }
    else { ownerA = other; ownerB = owner; }

    mgr.Memory.SetSummary(new CompactedSummary
    {
        PairKey = CanonicalPairKey(owner, other),
        OwnerA = ownerA,
        OwnerB = ownerB,
        SummaryText = summaryText,
        CoveredFromMs = coveredFromMs,
        CoveredUntilMs = coveredUntilMs,
        FoldedEntryCount = foldedEntryCount,
        CreatedAt = now,
    });

    // ---- STEP 6: SALIENCE GATE (§5.3, ai-town non-negotiable) ----
    // MemoryCompactor.cs:232-233:
    bool trivial = Math.Abs(affDelta) < AITavernConstants.AFFECT_DELTA_DEADBAND  // 0.08f
                   && emotionNeutral;

    if (!trivial)
    {
        // ---- STEP 7: Apply affect deltas FROM RAW TURNS, NOT Affect.Current(now) ----
        // MemoryCompactor.cs:237-275:
        // A dramatic mid-conv beat must survive even if already decayed below floor.

        // EMOTION: reverts to 平静/0 (Baseline=0, short half-life).
        if (mind.Emotion == null) mind.Emotion = new Affect();
        mind.Emotion.Label      = emotionLabel;
        mind.Emotion.Value      = Mathf.Clamp01(emotionIntensity);
        mind.Emotion.Baseline   = 0f;
        mind.Emotion.HalfLifeMs = AITavernConstants.EMOTION_HALFLIFE_MS;  // 90_000f
        mind.Emotion.LastSetMs  = now;

        // AFFECTION: canon baseline + long half-life (DO NOT overwrite Baseline/HalfLifeMs).
        var aff = ts.Affection;
        if (aff == null)
        {
            // Defensive: fall back to neutral 0 baseline when no canon available.
            aff = new Affect
            {
                Value      = 0f,
                Baseline   = 0f,
                HalfLifeMs = AITavernConstants.AFFECTION_HALFLIFE_MS,  // 900_000f
            };
            ts.Affection = aff;
        }
        aff.Value = Mathf.Clamp(aff.Value + affDelta, -1f, 1f);
        aff.LastSetMs = now;
        if (!string.IsNullOrWhiteSpace(emotionLabel) && !emotionNeutral)
            aff.Label = emotionLabel;  // Optional short standing hint
    }

    // ---- STEP 8: ImpressionDelta runtime overlay ----
    // MemoryCompactor.cs:277-282:
    // Bounded append of 往来印象 to ［本局所历］ (capped 3 entries, 600 chars).
    ts.ImpressionDelta = AppendImpressionDelta(ts.ImpressionDelta, summaryText, now);

    // ---- STEP 9: Tripwire for canon drift ----
    if (hasContradiction)
    {
        Debug.LogWarning(
            $"[Reflect] canon-contradiction owner={owner} other={other}: {contradiction.Trim()}");
    }

    // ---- STEP 10: Free raw buffer (mark consumed, clear ring) ----
    // MemoryCompactor.cs:299-300:
    foreach (var e in rawSpill) e.IsFolded = true;
    ts.Ring.Clear();

    return true;
}
```

#### **Helper: BuildReflectSystemPrompt()** (MemoryCompactor.cs:454-470)

```csharp
static string BuildReflectSystemPrompt()
{
    return
        "你在做「记忆沉淀」：把某武侠人物刚结束的一段对话，整理成他对对方的持久记忆，并判断这段经历对他情绪与好恶的净影响。\n"
        + "\n"
        + "仅输出中文。所有判断只依据下面给出的【原始逐字对话】本身，不要臆测对话之外的事，也不要沿用任何先前印象——这是为防止记忆失真。\n"
        + "\n"
        + "复述对方言行时用归属句式（「他声称」「据其所见」「他抱怨」等），不要用全知视角把任一方的话当作既成事实（人物会撒谎、虚张声势、口是心非）。\n"
        + "\n"
        + "情绪变化、好恶变化必须依据这段原始对话里实际发生的事来判断（即便其中的激烈时刻在现实里已经过去，也要如实记入沉淀）。\n"
        + "\n"
        + "严格按以下四行输出，每行以给定前缀开头，缺失内容写「空」：\n"
        + "往来印象：<2-4句，沉淀下来的关系认知，用归属句式>\n"
        + "情绪变化：<情绪词 + 强度0~1，例如「警惕 0.6」；若本局平淡写「平静」>\n"
        + "好恶变化：<带符号的好恶增量，区间[-1,1]，例如「-0.25」；若几乎无变化写「0」>\n"
        + "违背设定：<空，或一句简述：原始对话里是否有与人物设定/常识明显矛盾之处>";
}
```

#### **Helper: BuildReflectUserBody()** (MemoryCompactor.cs:475-486)

```csharp
static string BuildReflectUserBody(
    AITavernManager mgr, GameId self, GameId other, string rawConcat)
{
    var sb = new StringBuilder(1024);
    sb.Append("记忆的主人：").Append(FormatParticipantHeader(mgr, self)).Append('\n');
    sb.Append("对话的另一方：").Append(FormatParticipantHeader(mgr, other)).Append('\n');
    sb.Append('\n');
    sb.Append("【原始逐字对话】\n");
    sb.Append(rawConcat);
    if (!rawConcat.EndsWith("\n")) sb.Append('\n');
    return sb.ToString();
}
```

#### **Helper: ParseEmotion()** (MemoryCompactor.cs:508-543)

```csharp
static void ParseEmotion(string slot, out string label, out float intensity,
                         out bool isNeutral)
{
    label = "平静";
    intensity = 0f;
    isNeutral = true;

    if (string.IsNullOrWhiteSpace(slot)) return;
    slot = slot.Trim();

    // Extract first float (e.g. 0.6 from "警惕 0.6" or "警惕（0.6）").
    float? mag = ExtractFirstFloat(slot, out int magStart, out int magLen);

    // Label = slot with magnitude + separators stripped.
    string lbl = slot;
    if (mag.HasValue && magStart >= 0)
        lbl = (slot.Substring(0, magStart) + slot.Substring(magStart + magLen));
    lbl = lbl.Trim().Trim('（', '）', '(', ')', '，', ',', '：', ':', '、', ' ', '强', '度');
    lbl = lbl.Trim();

    if (IsNeutralLabel(lbl))
    {
        label = string.IsNullOrWhiteSpace(lbl) ? "平静" : lbl;
        intensity = 0f;
        isNeutral = true;
        return;
    }

    label = lbl;
    isNeutral = false;
    intensity = mag.HasValue ? Mathf.Clamp01(mag.Value) : EMOTION_DEFAULT_INTENSITY;  // 0.5f
}

static bool IsNeutralLabel(string lbl)
{
    if (string.IsNullOrWhiteSpace(lbl)) return true;
    switch (lbl)
    {
        case "平静": case "无": case "无明显变化": case "无变化": case "空":
        case "none": case "None": case "neutral": case "Neutral":
            return true;
        default:
            return false;
    }
}

// Extract first signed float from s (e.g. -0.25, +0.6, .5).
static float? ExtractFirstFloat(string s, out int start, out int len)
{
    start = -1; len = 0;
    if (string.IsNullOrEmpty(s)) return null;

    int i = 0;
    while (i < s.Length)
    {
        char c = s[i];
        bool sign = (c == '-' || c == '+') && i + 1 < s.Length
                    && (char.IsDigit(s[i + 1]) || s[i + 1] == '.');
        if (char.IsDigit(c) || sign || (c == '.' && i + 1 < s.Length && char.IsDigit(s[i + 1])))
        {
            int j = i;
            if (s[j] == '-' || s[j] == '+') j++;
            bool dot = false;
            while (j < s.Length && (char.IsDigit(s[j]) || (s[j] == '.' && !dot)))
            {
                if (s[j] == '.') dot = true;
                j++;
            }
            string num = s.Substring(i, j - i);
            if (float.TryParse(num, NumberStyles.Float, CultureInfo.InvariantCulture,
                               out float parsed))
            {
                start = i; len = j - i;
                return parsed;
            }
        }
        i++;
    }
    return null;
}
```

#### **Helper: ParseAffectionDelta()** (MemoryCompactor.cs:565-572)

```csharp
static float ParseAffectionDelta(string slot)
{
    if (string.IsNullOrWhiteSpace(slot)) return 0f;
    float? v = ExtractFirstFloat(slot.Trim(), out _, out _);
    if (!v.HasValue) return 0f;
    return Mathf.Clamp(v.Value, -1f, 1f);
}
```

#### **GlobalReflection Fold — T3D.4** (MemoryCompactor.cs:305-409)

```csharp
public static async UniTask FoldGlobalReflection(
    AITavernManager mgr, GameId owner, long now)
{
    if (mgr == null || mgr.Grok == null) return;

    var mind = mgr.GetOrCreateMind(owner);
    if (mind == null || mind.Targets == null) return;

    // Collect union of non-blank per-pair ReflectionSummary (current state).
    // Cross-pair staleness is INTENTIONAL (§5.3.1).
    var pairs = new List<(string name, string summary)>();
    foreach (var kv in mind.Targets)
    {
        var ts = kv.Value;
        if (ts == null || string.IsNullOrWhiteSpace(ts.ReflectionSummary))
            continue;
        pairs.Add((FormatParticipantHeader(mgr, kv.Key),
                   ts.ReflectionSummary.Trim()));
    }

    // Gate: ≥2 summaries only. With <2, global would just mirror the single pair.
    if (pairs.Count < 2) return;

    // One extra Grok fold: flat over SUMMARIES (not raw turns).
    string systemPrompt = BuildGlobalReflectSystemPrompt();
    string userBody = BuildGlobalReflectUserBody(mgr, owner, pairs);

    string raw;
    try
    {
        raw = await mgr.Grok.CompleteChatAsync(
            systemPrompt,
            new List<(string, string)> { ("user", userBody) },
            maxTokens: AITavernConstants.REFLECT_MAX_TOKENS,
            stopSequences: new[] { "User:", "Assistant:" },
            temperature: AITavernConstants.REFLECT_TEMPERATURE);
    }
    catch (Exception ex)
    {
        // Best-effort: log + bail WITHOUT touching GlobalReflection.
        // Per-pair consolidation already succeeded.
        Debug.LogWarning(
            $"[Reflect-Global] grok failed for owner={owner}: {ex.Message}");
        return;
    }

    string text = raw != null ? raw.Trim() : null;
    if (string.IsNullOrWhiteSpace(text))
    {
        Debug.LogWarning(
            $"[Reflect-Global] empty response for owner={owner}; leaving GlobalReflection unchanged");
        return;   // Best-effort — leave existing unchanged
    }

    const int GLOBAL_REFLECTION_MAX_CHARS = 300;
    if (text.Length > GLOBAL_REFLECTION_MAX_CHARS)
        text = text.Substring(0, GLOBAL_REFLECTION_MAX_CHARS).Trim();
    mind.GlobalReflection = text;
}

static string BuildGlobalReflectSystemPrompt()
{
    return
        "你在做「跨人反思」：下面是某武侠人物此刻对他所认识的几个人各自的印象（每条都是已经沉淀好的逐对印象，不是原始对话）。\n"
        + "\n"
        + "仅输出中文。请站在这个人物的角度，综观这几条印象，用不超过两句话点出你从这群人身上整体感到的共同点或暗流（例如「在场众人皆回避木箱话题、各怀心事」）。\n"
        + "\n"
        + "用归属句式（「我察觉」「众人似乎」「他们都」等），不要逐条复述每个人的印象——那是逐对记忆已经做过的；这里只综合出整体的模式或暗流。\n"
        + "\n"
        + "只输出这一两句话本身，不要加前缀、标号或解释。";
}

static string BuildGlobalReflectUserBody(
    AITavernManager mgr, GameId owner, List<(string name, string summary)> pairs)
{
    var sb = new StringBuilder(1024);
    sb.Append("反思的主人：").Append(FormatParticipantHeader(mgr, owner)).Append('\n');
    sb.Append('\n');
    sb.Append("【我对各人当前的印象】\n");
    foreach (var p in pairs)
    {
        sb.Append('「').Append(p.name).Append('」').Append('：')
          .Append(p.summary.Replace("\n", " ").Trim()).Append('\n');
    }
    return sb.ToString();
}
```

---

### 4. ContextAssembler.cs (Complete)

**Public method signature** (ContextAssembler.cs:47-139):

```csharp
public enum ContextProfile { Full, Leave }

public static string Build(Agent talker, Agent talkee, AITavernManager mgr, 
                           long now, ContextProfile profile)
{
    // Full profile (Start/Continue): §1-§4 static + §5.0/§5.1-5.4 + §5.5 per-target
    // Leave profile (farewell): §2 + §5.4 emotion-only + §5.5.3 ring-only
    // Section order FIXED. Empty sections omitted entirely.
    // Synchronous, zero Grok.
}
```

#### **FIXED section order and budgets** (ContextAssembler.cs:55-136):

```csharp
if (profile == ContextProfile.Full)
{
    // §1 World Codex — SECT_WORLD_BUDGET = 1500 chars
    AppendSection(sb, BuildWorld(mgr), AITavernConstants.SECT_WORLD_BUDGET);
    
    // §2 Talker bio — SECT_SELFBIO_BUDGET = 600 chars
    AppendSection(sb, BuildSelfBio(talkerBio), AITavernConstants.SECT_SELFBIO_BUDGET);
    
    // §3 Talkee first-impression surface — SECT_TALKEE_BUDGET = 400 chars
    // ANTI-OMNISCIENCE GUARDED (§6.2): structurally cannot read Personality/Identity/Plans
    AppendSection(sb, BuildTalkeeSurface(talkeeBio), AITavernConstants.SECT_TALKEE_BUDGET);
    
    // §4 Long-term knowledge (talker's Dossier view) — SECT_LONGTERM_BUDGET = 3000 chars
    // + runtime ImpressionDelta overlay (3D)
    AppendSection(sb, BuildLongTerm(talker, talkee, mgr), AITavernConstants.SECT_LONGTERM_BUDGET);
    
    // §5 Short-term (Situation/Task/Surroundings/Emotion) — SECT_SHORTTERM_BUDGET = 4000 chars
    AppendSection(sb, BuildShortTerm(talker, mgr, now), AITavernConstants.SECT_SHORTTERM_BUDGET);
    
    // §5.0 Global cross-person reflection (Full-only) — same budget
    AppendSection(sb, GlobalReflectionBlock(talker, mgr), AITavernConstants.SECT_SHORTTERM_BUDGET);
    
    // §5.5 per-target area (affection/summary/ring) (Full-only) — same budget
    AppendSection(sb, PerTargetBlock(talker, talkee, mgr, now), AITavernConstants.SECT_SHORTTERM_BUDGET);
}
else // Leave profile
{
    // §2 Talker bio — SECT_SELFBIO_BUDGET
    AppendSection(sb, BuildSelfBio(talkerBio), AITavernConstants.SECT_SELFBIO_BUDGET);
    
    // §5.4 Emotion-only block (NOT §5.1-5.3) — SECT_SHORTTERM_BUDGET
    AppendSection(sb, EmotionOnlyBlock(talker, mgr, now), AITavernConstants.SECT_SHORTTERM_BUDGET);
    
    // §5.5.3 Ring-only block (NOT §5.0/§5.5.1/§5.5.2) — SECT_SHORTTERM_BUDGET
    AppendSection(sb, RingOnlyBlock(talker, talkee, mgr), AITavernConstants.SECT_SHORTTERM_BUDGET);
}
```

#### **Anti-omniscience guard** (ContextAssembler.cs:342-380):

```csharp
// PUBLIC seam: extracts 4 surface fields only.
static string BuildTalkeeSurface(CharacterBio talkee)
{
    if (talkee == null) return null;
    return BuildTalkeeSurfaceSealed(
        talkee.BioName,
        talkee.Sex,
        talkee.AgeText,
        talkee.Appearance,
        talkee.SurfaceManner);
}

// STRUCTURAL guard: this method's signature CANNOT accept talkee.Personality/Identity/Plans/Relationships.
// Do NOT widen signature to take CharacterBio — the narrow argument list IS the guard.
static string BuildTalkeeSurfaceSealed(
    string bioName, Sex sex, string ageText, string appearance, string surfaceManner)
{
    bool hasAppearance = !string.IsNullOrWhiteSpace(appearance);
    bool hasManner = !string.IsNullOrWhiteSpace(surfaceManner);

    // If BOTH empty → omit §3 entirely (no lone 性别 line).
    if (!hasAppearance && !hasManner) return null;

    var sb = new StringBuilder();
    sb.Append("【对面是谁 — 初见印象】");
    sb.Append("\n姓名：").Append(string.IsNullOrWhiteSpace(bioName) ? "?" : bioName.Trim());
    sb.Append("  性别：").Append(SexText(sex));
    if (!string.IsNullOrWhiteSpace(ageText))
        sb.Append("  年龄：").Append(ageText.Trim());
    if (hasAppearance)
        sb.Append("\n外貌：").Append(appearance.Trim());
    if (hasManner)
        sb.Append("\n气度：").Append(surfaceManner.Trim());
    return sb.ToString();
}
```

#### **§4 Long-Term with runtime overlay** (ContextAssembler.cs:384-470)

```csharp
static string BuildLongTerm(Agent talker, Agent talkee, AITavernManager mgr)
{
    if (mgr == null || mgr.Dossiers == null) return null;
    string talkerId = talker != null ? talker.AgentId.Value : null;
    if (string.IsNullOrEmpty(talkerId)) return null;

    CharacterDossier d;
    if (!mgr.Dossiers.TryGetValue(talkerId, out d) || d == null)
        return null;   // no dossier → §4 omitted entirely

    var sb = new StringBuilder();
    sb.Append("【我所知 — 长期记忆】");
    bool any = false;

    // ·关于势力· (polity knowledge beyond World Codex)
    string polity = JoinKnowledge(d.PolityKnowledge);
    if (polity != null)
    {
        sb.Append("\n·关于势力·  ").Append(polity);
        any = true;
    }

    // ·关于门派· (faction knowledge beyond World Codex)
    string faction = JoinKnowledge(d.FactionKnowledge);
    if (faction != null)
    {
        sb.Append("\n·关于门派·  ").Append(faction);
        any = true;
    }

    // ·关于此人（<talkee>）· — match PersonView by talkee AgentId or BioName
    var talkeeBio = talkee != null ? talkee.Bio : null;
    string talkeeId = talkee != null ? talkee.AgentId.Value : null;
    string talkeeName = talkeeBio != null && !string.IsNullOrWhiteSpace(talkeeBio.BioName)
        ? talkeeBio.BioName.Trim()
        : (talkeeId ?? "?");

    var pv = FindPersonView(d.People, talkeeId, talkeeBio != null ? talkeeBio.BioName : null);
    if (pv != null)
    {
        sb.Append("\n·关于此人（").Append(talkeeName).Append("）·");
        if (!string.IsNullOrWhiteSpace(pv.Relationship))
            sb.Append("\n  关系：").Append(pv.Relationship.Trim());
        if (!string.IsNullOrWhiteSpace(pv.Impression))
            sb.Append("\n  印象：").Append(pv.Impression.Trim());
        if (!string.IsNullOrWhiteSpace(pv.MartialNote))
            sb.Append("\n  武功：").Append(pv.MartialNote.Trim());
        if (!string.IsNullOrWhiteSpace(pv.SharedHistory))
            sb.Append("\n  旧事：").Append(pv.SharedHistory.Trim());

        // 3D RUNTIME OVERLAY: ［本局所历］ — append after canon impression
        // READ-ONLY: TryGetValue, never GetOrCreateMind, never write CharacterDossier asset.
        // Sourced from RuntimeMindState.Targets[talkee].ImpressionDelta.
        if (mgr.Minds != null && talker != null && talkee != null)
        {
            RuntimeMindState mind;
            if (mgr.Minds.TryGetValue(talker.PlayerId, out mind)
                && mind != null && mind.Targets != null)
            {
                TargetState tts;
                if (mind.Targets.TryGetValue(talkee.PlayerId, out tts)
                    && tts != null
                    && !string.IsNullOrWhiteSpace(tts.ImpressionDelta))
                {
                    sb.Append("\n  ［本局所历］：").Append(tts.ImpressionDelta.Trim());
                }
            }
        }

        any = true;
    }

    return any ? sb.ToString() : null;
}
```

#### **Decay at read time: EmotionLine()** (ContextAssembler.cs:597-608)

```csharp
// §5.4 此刻心绪: decayed at READ time via Affect.Current(now).
// Returns null (omitted) when: no mind / unset OR Current(now) < EMOTION_FLOOR.
static string EmotionLine(RuntimeMindState mind, long now)
{
    if (mind == null || mind.Emotion == null) return null;   // unset
    float cur = mind.Emotion.Current(now);
    if (cur < AITavernConstants.EMOTION_FLOOR) return null;   // mood has passed
    // EMOTION_FLOOR = 0.12f (omit below)

    string label = mind.Emotion.Label;
    string intensity = cur.ToString("0.0", CultureInfo.InvariantCulture);
    if (string.IsNullOrWhiteSpace(label))
        return "此刻心绪：（强度 " + intensity + "，正缓缓平复）";
    return "此刻心绪：" + label.Trim() + "（强度 " + intensity + "，正缓缓平复）";
}
```

#### **PerTargetBlock (Full profile §5.5)** (ContextAssembler.cs:670-718)

```csharp
static string PerTargetBlock(Agent talker, Agent talkee, AITavernManager mgr, long now)
{
    if (talker == null || talkee == null || mgr == null || mgr.Minds == null) return null;

    RuntimeMindState mind;
    if (!mgr.Minds.TryGetValue(talker.PlayerId, out mind) || mind == null) return null;
    if (mind.Targets == null) return null;

    TargetState ts;
    if (!mind.Targets.TryGetValue(talkee.PlayerId, out ts) || ts == null) return null;

    bool hasAffection = ts.Affection != null;
    bool hasSummary = !string.IsNullOrWhiteSpace(ts.ReflectionSummary);
    bool hasRing = ts.Ring != null && ts.Ring.Count > 0;

    // ALL THREE empty → omit whole block (NO bare ·对 X· header).
    if (!hasAffection && !hasSummary && !hasRing) return null;

    var sb = new StringBuilder();
    sb.Append("·对 ").Append(TalkeeName(talkee)).Append('·');

    // §5.5.1 当下好恶 (read-time decayed).
    if (hasAffection)
    {
        float cur = ts.Affection.Current(now);   // LAZY DECAY
        string val = cur.ToString("0.00", CultureInfo.InvariantCulture);
        string label = ts.Affection.Label;
        if (string.IsNullOrWhiteSpace(label))
            sb.Append("\n当下好恶：").Append(val).Append("（向长期基线缓回）");
        else
            sb.Append("\n当下好恶：").Append(val)
              .Append('（').Append(label.Trim()).Append("，向长期基线缓回）");
    }

    // §5.5.2 往来印象（已沉淀）.
    if (hasSummary)
        sb.Append("\n往来印象（已沉淀）：").Append(ts.ReflectionSummary.Trim());

    // §5.5.3 最近交谈 ring.
    if (hasRing)
        AppendRing(sb, ts.Ring, talker, talkee);

    return sb.ToString();
}

// Ring rendering with ［刚刚结束的对话］ marker on last line.
static void AppendRing(StringBuilder sb, List<TurnRecord> ring, Agent talker, Agent talkee)
{
    sb.Append("\n最近交谈（最近").Append(ring.Count).Append("轮）：");
    int last = ring.Count - 1;
    for (int i = 0; i < ring.Count; i++)
    {
        var rec = ring[i];
        if (rec == null) continue;
        if (i == last)
            sb.Append("\n［刚刚结束的对话］");
        sb.Append('\n').Append(SpeakerName(rec.Speaker, talker, talkee))
          .Append('：').Append(rec.Text);
    }
}
```

---

### 5. AffectBaseline.cs (Complete)

```csharp
public static class AffectBaseline
{
    // Exhaustive over RelationType enum (Neutral / Ally / Friend / Rival / Enemy).
    // Symmetric-ish spread. Neutral = 0 (default for unset edges).
    public static float ForRelation(RelationType r)
    {
        switch (r)
        {
            case RelationType.Enemy:   return -0.7f;
            case RelationType.Rival:   return -0.4f;
            case RelationType.Neutral: return  0.0f;
            case RelationType.Ally:    return  0.4f;
            case RelationType.Friend:  return  0.6f;
            default:                   return  0.0f;
        }
    }
}
```

**Wiring:** Set at spawn via **T3C.2 (nowhere in the plan yet)** — the FSM seeds `ts.Affection.Baseline = AffectBaseline.ForRelation(bio.RelationTo(talkeeId))` when initializing a TargetState. When no canon edge exists, `RelationType.Neutral` → 0.0f baseline.

---

### 6. GrokClient.cs (Complete)

**Interface** (IGrokClient.cs:6-16):

```csharp
public interface IGrokClient
{
    Task<string> CompleteChatAsync(
        string systemPrompt,
        List<(string role, string content)> messages,
        int maxTokens = 200,
        string[] stopSequences = null,
        double temperature = 0.85);
}
```

**Implementation** (GrokClient.cs:27-106):

```csharp
public class GrokClient : IGrokClient
{
    const string ENDPOINT = "https://api.x.ai/v1/chat/completions";
    const string MODEL = "grok-4.20-non-reasoning";
    const int TIMEOUT_SEC = 30;

    readonly string _apiKey;

    public GrokClient(string apiKey = null)
    {
        _apiKey = apiKey ?? LoadApiKey();
    }

    // API-KEY RESOLUTION ORDER (GrokClient.cs:45-68):
    // 1. Environment variable XAI_API_KEY
    // 2. File at Application.persistentDataPath/aitavern/xai_key.txt
    // Missing → returns null; CompleteChatAsync throws InvalidOperationException on call
    static string LoadApiKey()
    {
        try
        {
            var env = Environment.GetEnvironmentVariable("XAI_API_KEY");
            if (!string.IsNullOrEmpty(env)) return env;
        }
        catch (Exception e)
        {
            Debug.LogWarning($"[GrokClient] failed reading XAI_API_KEY env: {e.Message}");
        }

        try
        {
            var path = System.IO.Path.Combine(Application.persistentDataPath, "aitavern", "xai_key.txt");
            if (System.IO.File.Exists(path)) return System.IO.File.ReadAllText(path).Trim();
        }
        catch (Exception e)
        {
            Debug.LogWarning($"[GrokClient] failed reading key file: {e.Message}");
        }

        return null;
    }

    public bool HasKey => !string.IsNullOrEmpty(_apiKey);

    public async Task<string> CompleteChatAsync(
        string systemPrompt,
        List<(string role, string content)> messages,
        int maxTokens = 200,
        string[] stopSequences = null,
        double temperature = 0.85)
    {
        if (string.IsNullOrEmpty(_apiKey))
            throw new InvalidOperationException(
                "XAI_API_KEY not set. Provide env var XAI_API_KEY or "
                + "persistentDataPath/aitavern/xai_key.txt.");

        var bodyJson = BuildBodyJson(systemPrompt, messages, maxTokens, stopSequences, temperature);

        using (var req = new UnityWebRequest(ENDPOINT, "POST"))
        {
            var raw = Encoding.UTF8.GetBytes(bodyJson);
            req.uploadHandler = new UploadHandlerRaw(raw) { contentType = "application/json" };
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Authorization", "Bearer " + _apiKey);
            req.SetRequestHeader("Content-Type", "application/json");
            req.timeout = TIMEOUT_SEC;

            await req.SendWebRequest().ToUniTask();

            if (req.result != UnityWebRequest.Result.Success)
            {
                var msg = $"[GrokClient] HTTP {req.responseCode}: {req.error}";
                Debug.LogWarning(msg);
                throw new Exception(msg);
            }

            return ParseChoiceText(req.downloadHandler.text);
        }
    }
}
```

**Call sites & parameters:**
- **ConsolidateForOwner()** (MemoryCompactor.cs:142-147):
  - `maxTokens: AITavernConstants.REFLECT_MAX_TOKENS` (500)
  - `temperature: AITavernConstants.REFLECT_TEMPERATURE` (0.3f) — factual consolidation
- **FoldGlobalReflection()** (MemoryCompactor.cs:376-381):
  - `maxTokens: AITavernConstants.REFLECT_MAX_TOKENS` (500)
  - `temperature: AITavernConstants.REFLECT_TEMPERATURE` (0.3f)

---

### 7. AITavernConstants.cs (All Phase 3 constants)

```csharp
// Phase 3A — section budgets (chars)
public const int SECT_WORLD_BUDGET    = 1500;  // §1
public const int SECT_SELFBIO_BUDGET  = 600;   // §2
public const int SECT_TALKEE_BUDGET   = 400;   // §3
public const int SECT_LONGTERM_BUDGET = 3000;  // §4
public const int SECT_SHORTTERM_BUDGET= 4000;  // §5 (all of 5.1-5.5)

// Phase 3C — affect decay (lazy exp via Current())
public const float EMOTION_HALFLIFE_MS   = 90_000f;    // ~1.5 min (reverts to 平静/0)
public const float EMOTION_FLOOR         = 0.12f;      // below → omit §5.4
public const float AFFECTION_HALFLIFE_MS = 900_000f;   // ~15 min (reverts to canon baseline)

// Phase 3D — reflection & ring
public const int   MEMORY_RING_CAP        = 10;        // anchor + 9 recent
public const float AFFECT_DELTA_DEADBAND  = 0.08f;     // salience gate |Δ| below threshold + neutral emotion → no delta apply

// Phase 3D — Grok call for reflection
public const int   REFLECT_MAX_TOKENS     = 500;
public const float REFLECT_TEMPERATURE    = 0.3f;
```

---

### 8. CharacterBio.cs & CharacterDossier.cs (Field lists)

**CharacterBio (Phase 3 fields only)** (CharacterBio.cs:30-67):

```csharp
[CreateAssetMenu(fileName = "Bio_Character", menuName = "AI Tavern/CharacterBio", order = 0)]
public class CharacterBio : ScriptableObject
{
    // Phase 0/1/2 (pre-3D) — kept for compatibility
    public string AgentId;
    public int RoleId;
    public int HeadId;
    public string BioName;
    [TextArea(3, 6)] public string Identity;       // §2 (fallback when Personality empty)
    [TextArea(2, 5)] public string Plans;
    public List<RelationshipEntry> Relationships;
    public List<InterestEntry> Interests;
    public List<int> StartingItems;
    public string SpawnMarkerName;

    // --- Phase 3 demographic / surface / trait split ---
    public Sex Sex;                                 // Persona core (survives)
    public string AgeText;                         // Persona core (survives)
    [TextArea] public string Personality;          // §2 性情 (talker self) — persona core
    [TextArea] public string Appearance;           // §3 外貌 (first-impression surface) — persona core
    [TextArea] public string SurfaceManner;        // §3 气度 (first-impression demeanor) — persona core

    // Phase 3B — optional scene seed
    [TextArea] public string DefaultSituation;     // §5.1
    [TextArea] public string DefaultTask;          // §5.2
}
```

**Lore-derived fields (LORE-COUPLED, must be cut/replaced):**
- `Identity` (Phase 2 fallback when Personality empty — if Identity is lore-heavy, it's coupled)
- `Plans` (may reference canon plot points)
- `Relationships` (canon relationship graph — replaced with runtime RelationType)
- `Interests` (may reference canon characters/items)

**Lore-free core (PERSONA, ports as-is):**
- `Sex`, `AgeText`, `Personality`, `Appearance`, `SurfaceManner` — hand-authored persona
- `BioName`, `AgentId`, `RoleId`, `HeadId` — identifiers
- `SpawnMarkerName` — world placement
- `StartingItems` — mechanical (can be decoupled from lore)

---

**CharacterDossier (Phase 3 — entire file is lore-coupled)**
(CharacterDossier.cs:1-36):

```csharp
[CreateAssetMenu(fileName = "Dossier_Character", menuName = "AI Tavern/CharacterDossier", order = 11)]
public class CharacterDossier : ScriptableObject
{
    public string AgentId;                                              // link
    public List<KnowledgeLine> PolityKnowledge;    // §4.1.1 beyond World Codex
    public List<KnowledgeLine> FactionKnowledge;   // §4.1.2 beyond World Codex
    public List<PersonView> People;                // §4.2 curated notable set
}

[System.Serializable]
public class KnowledgeLine
{
    public string Subject;
    [TextArea] public string Text;
}

[System.Serializable]
public class PersonView
{
    public string Target;                          // AgentId or canonical name
    [TextArea] public string Relationship;         // §4.2.1
    [TextArea] public string Impression;           // §4.2.2
    [TextArea] public string MartialNote;          // §4.2.3 (武功 = martial arts knowledge)
    [TextArea] public string SharedHistory;        // §4.2.4 (共历 = shared history)
    [TextArea] public string TheyDoNotKnow;        // §5.5.4 backing (theory-of-mind: what this person canonically doesn't know about owner)
}
```

**Classification:**
- **ENTIRE CharacterDossier** is **LORE-COUPLED** (§1 & §4 dossier from novel)
  - PolityKnowledge, FactionKnowledge = beyond World Codex, canon-derived
  - People.PersonView = per-person relationship/impression/martial/history = canon-derived
- When lore is deleted: delete Dossier assets; ContextAssembler gracefully omits §4 when dossier key missing (TryGetValue returns null → §4 omitted).

---

### 9. WorldCodex.cs (Entire file is LORE-COUPLED)

(WorldCodex.cs:1-50):

```csharp
[CreateAssetMenu(fileName = "WorldCodex", menuName = "AI Tavern/WorldCodex", order = 10)]
public class WorldCodex : ScriptableObject
{
    [TextArea] public string Era;                              // §1 时代
    public List<PolityEntry> Polities;       // 国/势力 + pairwise relations
    public List<FactionEntry> Factions;      // 门派 + pairwise relations
    public List<NotableFigure> NotableFigures;  // "everyone knows" set
}

[System.Serializable]
public class RelationLine { public string Target; [TextArea] public string Text; }
[System.Serializable]
public class PolityEntry { public string Name; [TextArea] public string Brief; public List<RelationLine> Relations; }
[System.Serializable]
public class FactionEntry { public string Name; [TextArea] public string Brief; public string HomeRegion; public List<RelationLine> Relations; }
[System.Serializable]
public class NotableFigure { public string Name; public string Polity; public string Faction; [TextArea] public string OneLine; }
```

**Classification:** **ENTIRE WorldCodex IS LORE-COUPLED** — all fields = canon-derived. Delete entirely; ContextAssembler gracefully omits §1 when World == null.

---

## DESIGN DOC & INVARIANTS EXTRACTION

### From **AITavern_Phase3_Plan.md**

#### §5.3 Reflection-Consolidation Invariants (Plan §5.3-§5.3.1):

1. **One per pair, re-fold from raw always:**
   - Prior `ReflectionSummary` is **DISCARDED** as Grok input.
   - Every consolidation re-generates summary from raw turn text only (bounded to 1 Grok hop).
   - Anti-degradation rule: no summary-of-summary chaining.

2. **4-slot output structure (往来印象/情绪变化/好恶变化/违背设定):**
   - **往来印象**: 2-4句持久关系认知 (durable per-pair summary) → `ReflectionSummary`, `ImpressionDelta` overlay.
   - **情绪变化**: emotion label + intensity 0..1 → read from RAW turns (not decayed `Current(now)`).
   - **好恶变化**: signed delta [-1,1] → read from RAW turns.
   - **违背设定**: canon-contradiction flag (tripwire for licensed IP).

3. **Salience gate (AFFECT_DELTA_DEADBAND = 0.08f):**
   - Condition: `|好恶变化| < 0.08f AND 情绪变化 neutral label`
   - Result: Summary **still folded**, but `Emotion.Value`, `Affection.Value`, `LastSetMs` **NOT updated**.
   - Purpose: Chit-chat cannot starve baseline-reversion decay by perpetually resetting `LastSetMs`.

4. **Affect deltas applied from RAW, not decayed:**
   - A dramatic mid-conversation event must survive into durable disposition **even if its mood already decayed below floor** before consolidation runs.
   - Parsed emotion/affection from Grok output are the source of truth, not `Affect.Current(now)`.

5. **§5.0 GlobalReflection guarantees (flat/output-only/≥2-gate/staleness-intentional/best-effort):**
   - **Input**: Union of THIS talker's non-blank `Targets[*].ReflectionSummary` (already-distilled, not raw).
   - **Flat**: Fold SUMMARIES, not raw turns (NOT a degradation — anti-degradation applies to per-pair only).
   - **Output-only**: Writes ONLY `mind.GlobalReflection`. Never fed back as input to any per-pair fold (no feedback loop, no recursion).
   - **≥2-gate**: Skips fold when <2 non-empty summaries (global would just mirror single pair).
   - **Cross-pair staleness intentional**: Reads CURRENT state of all targets; only just-finished pair is refreshed, others are as-of last interaction. That is correct — "what I last gathered about everyone," not omniscient.
   - **Best-effort on Grok failure**: Log + bail WITHOUT touching `GlobalReflection` (per-pair consolidation already succeeded; failed global must not corrupt it).

#### Ring-append co-location ordering invariant (Plan §5.1):

- `TurnRecord` appended to `TargetState.Ring` at **SAME call site** that appends to `Conversation.Transcript`.
- Called synchronously **BEFORE** any async Grok work.
- This co-location is what makes `BuildContinue`'s `AppendTranscript` deletion safe: the ring is the **sole recent-turn source**.
- Invariant assertion: after a turn is added (both ring + transcript), a subsequent `BuildContinue` prompt **contains that turn** (via ring), never omitted.

#### Moot/trivial invariants with ONE NPC + ONE PC + NO CANON:

1. **AffectBaseline with no canon:**
   - When there is no `RelationshipGraph` (no canon), default all edges to `Neutral` → baseline 0.0f.
   - Affection still decays toward 0 (but that's the baseline anyway), just at the `AFFECTION_HALFLIFE_MS` rate.

2. **GlobalReflection with a single pair:**
   - <2 summaries → gate skips fold (correct even with 1 NPC + 1 PC).
   - No change needed.

3. **"违背设定" canon-contradiction slot with no canon:**
   - Still emitted (empty/"空") — the prompt asks for it regardless.
   - With no canon, the model should naturally answer "空" (no contradiction).
   - No change needed; model learns to emit "空" when there is no reference frame.

---

### From **aitavern_invariants.md**

*(No new Phase 3D-specific invariants added beyond the plan, but inherited Phase 1/2 invariants remain)*

---

## WHAT IS LORE-COUPLED (DELETE/REPLACE)

**Lore-Coupled Assets & Code:**

1. **CharacterDossier.cs** — **ENTIRE file** (all 4 fields)
   - Delete all instances from Resources/
   - ContextAssembler gracefully handles missing dossiers (→ §4 omitted)

2. **WorldCodex.cs** — **ENTIRE file** (all fields)
   - Delete instance from Resources/
   - ContextAssembler gracefully handles null World (→ §1 omitted)

3. **CharacterBio.cs — lore-heavy fields** (if present):
   - `Identity` (Phase 2 fallback) — if it references canon plot, external lore, or faction knowledge → delete or clear
   - `Plans` — if they reference canon events → delete or clear
   - `Relationships` — **entirely replaced by runtime RelationType** in §3C seeding; discard canon list
   - `Interests` — if they reference canon characters/items → delete or replace with generic interests

**Persona-core fields (KEEP AS-IS):**
- `BioName`, `Sex`, `AgeText`, `Personality`, `Appearance`, `SurfaceManner`
- These are hand-authored persona that can be ported 1:1.

---

## WHAT IS THE LORE-FREE HUMAN-MEMORY CORE (PORTS AS-IS)

**Pure algorithm components (zero lore coupling):**

1. **RuntimeMindState.cs** — entire file (§5 containers)
   - Affect decay formula (exponential, lazy)
   - Ring structure (anchor + cap)
   - Targets dict (per-talkee state)
   - No lore content, pure structure

2. **EpisodicRing.cs** — entire file (§5.1 ring-append logic)
   - Append → cap → evict → spill flow
   - No lore, pure mechanic

3. **MemoryCompactor.cs** — **body + algorithm, but PROMPT IS LORE-LOCKED**
   - **Keep algorithm**: `ConsolidateForOwner()` flow (collect raw, call Grok, parse slots, apply deltas, write summary)
   - **Replace prompts**: `BuildReflectSystemPrompt()` + `BuildReflectUserBody()` + `BuildGlobalReflectSystemPrompt()` + `BuildGlobalReflectUserBody()`
     - Current prompts use Chinese + martial-arts framing (武侠)
     - Port: keep structure (4-slot, raw-only input, emission format), translate/adapt prompts for new setting
   - **Keep parsing**: `ParseEmotion()`, `ParseAffectionDelta()`, slot extraction (language-agnostic)
   - **Keep helpers**: `AppendImpressionDelta()`, `FoldGlobalReflection()`, decay/affect logic

4. **ContextAssembler.cs** — **section builders are lore-locked EXCEPT structure**
   - **Keep**: Fixed section order (§1-§5), empty-omission logic, budget/truncation, decay at read time, ring rendering
   - **Replace**: `BuildWorld()` (§1), `BuildLongTerm()` (§4) — these pull from lore assets
   - **Keep**: `BuildSelfBio()` (§2), `BuildTalkeeSurface()` (§3) — pull from persona-core bio fields
   - **Keep**: `BuildShortTerm()`, `EmotionLine()`, `PerTargetBlock()`, ring logic — pure rendering of volatile state
   - **Keep**: `GlobalReflectionBlock()` — pure rendering of folded global summary

5. **Affect (decay math)** — **ENTIRE Affect.Current() is lore-free**
   - Exponential decay formula (no language/setting dependency)
   - Pure POCO (System.Math, not game-specific)

6. **AffectBaseline.cs** — **logic is lore-free, values may need retuning**
   - Formula is generic: RelationType enum → baseline scalar
   - Spreads (-0.7 to +0.6) are tunable; reuse as-is if they fit your relationship types
   - If your game has different relationship categories (e.g., no "Rival"), edit enum + switch

7. **GrokClient.cs** — **ENTIRE file is engine/API-agnostic**
   - HTTP client for xAI Grok (reusable if Grok is your LLM)
   - If you switch to a different LLM (Claude, GPT), reimplement `IGrokClient` interface (same signature)
   - LoadApiKey() order + endpoint can be reused

8. **AITavernConstants.cs** — **ENTIRE Phase 3 section**
   - All decay half-lives, budgets, thresholds are tunable (not lore-dependent)
   - Reuse values as-is (they're based on cognitive theory, not canon)

9. **RelationshipGraph.cs** — **ENTIRE file is lore-free**
   - Asymmetric directed graph; unset edges default to Neutral
   - Generic data structure; porting requires only seeding the graph (no canon edge definitions in this file itself)

10. **MemoryStash.cs** — **ENTIRE file is lore-free**
    - Append + consolidation storage; generic MemoryEntry/CompactedSummary shapes
    - No lore content

---

## PORTING CHECKLIST FOR TYPESCRIPT/CONVEX

### Delete / NOT port:
- [ ] CharacterDossier.cs (and all .asset files)
- [ ] WorldCodex.cs (and .asset file)
- [ ] Lore-heavy fields from CharacterBio (Identity, Plans, Relationships, Interests if canon-coupled)
- [ ] Chinese-language reflection prompts in MemoryCompactor

### Port as-is (pure algorithm):
- [ ] RuntimeMindState data shape (Affect decay math, TurnRecord, TargetState, ring structure)
- [ ] EpisodicRing append/evict/spill logic
- [ ] MemoryCompactor ConsolidateForOwner() algorithm (replace prompts)
- [ ] MemoryCompactor ParseEmotion(), ParseAffectionDelta(), slot extraction
- [ ] MemoryCompactor FoldGlobalReflection() algorithm (replace prompts)
- [ ] ContextAssembler section order, budgets, empty-omission, decay rendering (replace lore builders §1/§4)
- [ ] Affect.Current() exponential decay formula
- [ ] AffectBaseline RelationType→scalar mapping (optionally retune spreads)
- [ ] GrokClient HTTP plumbing (or swap for your LLM's client, keep IGrokClient interface)
- [ ] AITavernConstants decay/budget values (retune per your game's pacing)
- [ ] RelationshipGraph directed edge store
- [ ] MemoryStash append/consolidate mechanics

### Rewrite for new setting:
- [ ] Reflection prompts (system + user body builders) — keep structure, adapt language/framing
- [ ] ContextAssembler § 1 & § 4 builders (replace lore asset reads with your setting's knowledge sources, or omit)
- [ ] CharacterBio fields: keep persona core (Sex, AgeText, Personality, Appearance, SurfaceManner), replace canon fields
- [ ] RelationshipGraph seeding: instead of novel-scanned, use your game's faction/relationship definition

---

## COMPLETE ALGORITHM BODIES — VERBATIM QUOTES

All quoted algorithm bodies above are verbatim from source files with file:line citations. Key extractions:

- **Affect.Current(long now)** — RuntimeMindState.cs:51-56
- **EpisodicRing.Record()** — EpisodicRing.cs:28-102
- **MemoryCompactor.ConsolidateForOwner()** — MemoryCompactor.cs:66-303 (complete with all parsing)
- **MemoryCompactor.FoldGlobalReflection()** — MemoryCompactor.cs:341-409
- **ContextAssembler.Build() section order** — ContextAssembler.cs:47-139
- **ContextAssembler anti-omniscience guard** — ContextAssembler.cs:342-380
- **AffectBaseline.ForRelation()** — AffectBaseline.cs:24-35
- **GrokClient.CompleteChatAsync()** — GrokClient.cs:72-106

---

**This extraction is implementation-grade and ready for TypeScript/Convex reimplementation.**