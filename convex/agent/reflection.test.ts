// P1-1D.A reflection-core unit tests. Invariants from
// HumanMemory_AITown_Plan v3.1: N4 (re-fold structure), N5 (4-slot parse),
// N6 (salience gate), N8 (no Affection.Label here — applied in 1D.B
// wiring; tested there), S4 GlobalReflection prompt shape, S6
// ImpressionDelta cap, N13 display-name speakers.

import {
  SLOT_IMPRESSION,
  SLOT_EMOTION,
  SLOT_AFFECTION,
  SLOT_CONTRADICTION,
  buildReflectSystemPrompt,
  buildReflectUserBody,
  buildGlobalReflectSystemPrompt,
  buildGlobalReflectUserBody,
  clampGlobalReflection,
  extractSlot,
  extractFirstFloat,
  isNeutralLabel,
  parseEmotion,
  parseAffectionDelta,
  hasContradiction,
  isTrivial,
  appendImpressionDelta,
  buildRawBody,
} from './reflection';
import {
  AFFECT_DELTA_DEADBAND,
  EMOTION_DEFAULT_INTENSITY,
  GLOBAL_REFLECTION_MAX_CHARS,
  IMPRESSION_DELTA_MAX_CHARS,
  IMPRESSION_DELTA_MAX_ENTRIES,
} from '../constants';

// ──────────────────────────────────────────────────────────────────
describe('Slot prefixes (byte-identical to jynew, N5)', () => {
  test('exact 4 prefixes, Chinese fullwidth colon', () => {
    expect(SLOT_IMPRESSION).toBe('往来印象：');
    expect(SLOT_EMOTION).toBe('情绪变化：');
    expect(SLOT_AFFECTION).toBe('好恶变化：');
    expect(SLOT_CONTRADICTION).toBe('违背设定：');
  });
});

// ──────────────────────────────────────────────────────────────────
describe('buildReflectSystemPrompt (S5/S7 generic-persona framing)', () => {
  const sys = buildReflectSystemPrompt();
  test('drops 武侠 wording, uses generic 这位角色', () => {
    expect(sys).not.toContain('武侠');
    expect(sys).toContain('这位角色');
  });
  test('keeps raw-only / attribution / Chinese-only / 缺失→空 invariants', () => {
    expect(sys).toContain('原始逐字对话');
    expect(sys).toContain('归属句式');
    expect(sys).toContain('仅输出中文');
    expect(sys).toContain('缺失内容写「空」');
  });
  test('emits all 4 slot prefixes verbatim', () => {
    expect(sys).toContain(SLOT_IMPRESSION);
    expect(sys).toContain(SLOT_EMOTION);
    expect(sys).toContain(SLOT_AFFECTION);
    expect(sys).toContain(SLOT_CONTRADICTION);
  });
  test('R3 lens-3 R-2: 违背设定 reference frame names 自我设定 explicitly', () => {
    expect(sys).toContain('自我设定');
    expect(sys).toContain('人物设定');
  });
});

// ──────────────────────────────────────────────────────────────────
describe('buildReflectUserBody (N13 display names; §2 reference frame)', () => {
  test('includes 自我设定 line when personality present', () => {
    const body = buildReflectUserBody({
      ownerName: '琳娜',
      ownerPersonality: '温文尔雅',
      otherName: '李平',
      rawConcat: '琳娜: 你好\n李平: 你好',
    });
    expect(body).toContain('记忆的主人：琳娜');
    expect(body).toContain('自我设定：温文尔雅');
    expect(body).toContain('对话的另一方：李平');
    expect(body).toContain('【原始逐字对话】');
    expect(body).toContain('琳娜: 你好');
    expect(body).toContain('李平: 你好');
  });
  test('omits 自我设定 line when personality empty (graceful degrade)', () => {
    const body = buildReflectUserBody({
      ownerName: 'X',
      ownerPersonality: '',
      otherName: 'Y',
      rawConcat: 'X: a',
    });
    expect(body).not.toContain('自我设定');
  });
  test('never emits a raw id — both names rendered as display strings', () => {
    const body = buildReflectUserBody({
      ownerName: '琳娜',
      ownerPersonality: 'p',
      otherName: '李平',
      rawConcat: '',
    });
    expect(body).not.toMatch(/[a-f0-9]{20,}/i); // no engine-id-looking strings
  });
});

// ──────────────────────────────────────────────────────────────────
describe('extractSlot (handles multi-line slot content)', () => {
  const fourSlot = `往来印象：他似乎心地不坏，\n但说话有些躲闪。\n情绪变化：警惕 0.6\n好恶变化：-0.2\n违背设定：空`;
  test('extracts each slot correctly across lines', () => {
    expect(extractSlot(fourSlot, SLOT_IMPRESSION)).toBe('他似乎心地不坏，\n但说话有些躲闪。');
    expect(extractSlot(fourSlot, SLOT_EMOTION)).toBe('警惕 0.6');
    expect(extractSlot(fourSlot, SLOT_AFFECTION)).toBe('-0.2');
    expect(extractSlot(fourSlot, SLOT_CONTRADICTION)).toBe('空');
  });
  test('returns null when prefix absent', () => {
    expect(extractSlot('garbage', SLOT_IMPRESSION)).toBeNull();
    expect(extractSlot('', SLOT_IMPRESSION)).toBeNull();
  });
  test('handles trailing whitespace and missing trailing slots', () => {
    const partial = '往来印象：summary only';
    expect(extractSlot(partial, SLOT_IMPRESSION)).toBe('summary only');
    expect(extractSlot(partial, SLOT_EMOTION)).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────
describe('extractFirstFloat (jynew MemoryCompactor.cs:576-609)', () => {
  test('plain numbers', () => {
    expect(extractFirstFloat('0.6')?.value).toBe(0.6);
    expect(extractFirstFloat('警惕 0.6')?.value).toBe(0.6);
    expect(extractFirstFloat('（0.6）')?.value).toBe(0.6);
  });
  test('signed numbers', () => {
    expect(extractFirstFloat('-0.25')?.value).toBe(-0.25);
    expect(extractFirstFloat('+0.6')?.value).toBe(0.6);
    expect(extractFirstFloat('好恶 -0.5')?.value).toBe(-0.5);
  });
  test('leading dot', () => {
    expect(extractFirstFloat('.5')?.value).toBe(0.5);
  });
  test('no float → null', () => {
    expect(extractFirstFloat('平静')).toBeNull();
    expect(extractFirstFloat('')).toBeNull();
    expect(extractFirstFloat('-')).toBeNull(); // lone sign, no digit after
  });
  test('returns position info for label-stripping', () => {
    const r = extractFirstFloat('警惕 0.6')!;
    expect(r.start).toBe(3); // after "警惕 "
    expect(r.len).toBe(3); // "0.6"
  });
});

// ──────────────────────────────────────────────────────────────────
describe('isNeutralLabel (jynew NEUTRAL_LABELS set)', () => {
  test('Chinese neutral labels', () => {
    for (const lbl of ['平静', '无', '无明显变化', '无变化', '空']) {
      expect(isNeutralLabel(lbl)).toBe(true);
    }
  });
  test('English neutral labels', () => {
    for (const lbl of ['none', 'None', 'neutral', 'Neutral']) {
      expect(isNeutralLabel(lbl)).toBe(true);
    }
  });
  test('non-neutral labels', () => {
    for (const lbl of ['警惕', '愤怒', '喜悦', '恐惧', 'happy']) {
      expect(isNeutralLabel(lbl)).toBe(false);
    }
  });
  test('empty / whitespace → neutral', () => {
    expect(isNeutralLabel('')).toBe(true);
    expect(isNeutralLabel('   ')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────
describe('parseEmotion (N5)', () => {
  test('empty / null → 平静/0/neutral', () => {
    expect(parseEmotion('')).toEqual({ label: '平静', intensity: 0, isNeutral: true });
    expect(parseEmotion(null)).toEqual({ label: '平静', intensity: 0, isNeutral: true });
    expect(parseEmotion(undefined)).toEqual({ label: '平静', intensity: 0, isNeutral: true });
  });
  test('label + intensity', () => {
    expect(parseEmotion('警惕 0.6')).toEqual({ label: '警惕', intensity: 0.6, isNeutral: false });
    expect(parseEmotion('喜悦（0.4）')).toEqual({ label: '喜悦', intensity: 0.4, isNeutral: false });
  });
  test('non-neutral with no magnitude → EMOTION_DEFAULT_INTENSITY (0.5)', () => {
    expect(parseEmotion('警惕')).toEqual({
      label: '警惕',
      intensity: EMOTION_DEFAULT_INTENSITY,
      isNeutral: false,
    });
  });
  test('neutral label → intensity 0 regardless of magnitude', () => {
    expect(parseEmotion('平静 0.4')).toEqual({ label: '平静', intensity: 0, isNeutral: true });
  });
  test('intensity clamped to [0, 1]', () => {
    expect(parseEmotion('警惕 1.5').intensity).toBe(1);
    expect(parseEmotion('警惕 -0.3').intensity).toBe(0); // negative clamped to 0
  });
});

// ──────────────────────────────────────────────────────────────────
describe('parseAffectionDelta (N5)', () => {
  test('empty → 0', () => {
    expect(parseAffectionDelta('')).toBe(0);
    expect(parseAffectionDelta(null)).toBe(0);
    expect(parseAffectionDelta('0')).toBe(0);
  });
  test('signed numbers', () => {
    expect(parseAffectionDelta('-0.25')).toBe(-0.25);
    expect(parseAffectionDelta('+0.6')).toBe(0.6);
  });
  test('clamped to [-1, 1]', () => {
    expect(parseAffectionDelta('1.5')).toBe(1);
    expect(parseAffectionDelta('-1.5')).toBe(-1);
  });
  test('non-numeric → 0', () => {
    expect(parseAffectionDelta('无')).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────
describe('hasContradiction (N5)', () => {
  test('empty / 空 → false', () => {
    expect(hasContradiction('')).toBe(false);
    expect(hasContradiction('  ')).toBe(false);
    expect(hasContradiction('空')).toBe(false);
    expect(hasContradiction(null)).toBe(false);
  });
  test('non-empty actual contradiction → true', () => {
    expect(hasContradiction('琳娜自称大学毕业')).toBe(true);
    expect(hasContradiction('与人物设定矛盾')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────
describe('isTrivial (N6 salience gate)', () => {
  test('both conditions → trivial', () => {
    expect(isTrivial(0, true)).toBe(true);
    expect(isTrivial(0.05, true)).toBe(true);
    expect(isTrivial(-0.05, true)).toBe(true);
  });
  test('|affDelta| ≥ AFFECT_DELTA_DEADBAND (0.08) → NOT trivial', () => {
    expect(isTrivial(AFFECT_DELTA_DEADBAND, true)).toBe(false);
    expect(isTrivial(0.1, true)).toBe(false);
    expect(isTrivial(-0.1, true)).toBe(false);
  });
  test('emotion not neutral → NOT trivial', () => {
    expect(isTrivial(0, false)).toBe(false);
    expect(isTrivial(0.05, false)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────
describe('appendImpressionDelta (S6 cap 3 entries / 600 chars)', () => {
  test('empty addition → keep existing untouched', () => {
    expect(appendImpressionDelta('prev', '', 1000)).toBe('prev');
    expect(appendImpressionDelta('prev', '   ', 1000)).toBe('prev');
  });
  test('appends one entry with timestamp', () => {
    const out = appendImpressionDelta('', '他似乎心地不坏', 1700000000000);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} · 他似乎心地不坏$/);
  });
  test('cap 3 entries (oldest dropped)', () => {
    let s = '';
    for (let i = 0; i < 5; i++) {
      s = appendImpressionDelta(s, `entry${i}`, 1700000000000 + i * 60000);
    }
    const lines = s.split('\n');
    expect(lines.length).toBe(IMPRESSION_DELTA_MAX_ENTRIES);
    expect(s).toContain('entry4'); // newest kept
    expect(s).toContain('entry3');
    expect(s).toContain('entry2');
    expect(s).not.toContain('entry0'); // oldest dropped
    expect(s).not.toContain('entry1');
  });
  test('cap total chars (oldest trimmed from front, ellipsis prefix)', () => {
    let s = '';
    const big = 'x'.repeat(300);
    for (let i = 0; i < 3; i++) {
      s = appendImpressionDelta(s, `${big}#${i}`, 1700000000000 + i * 60000);
    }
    expect(s.length).toBeLessThanOrEqual(IMPRESSION_DELTA_MAX_CHARS);
    expect(s).toContain('#2'); // newest preserved
    expect(s.startsWith('…')).toBe(true);
  });
  test('multi-line addition collapsed to single line', () => {
    const out = appendImpressionDelta('', 'line1\nline2', 1700000000000);
    expect(out.split('\n').length).toBe(1);
    expect(out).toContain('line1 line2');
  });
});

// ──────────────────────────────────────────────────────────────────
describe('buildRawBody (N4/N13 — display-name speakers, oldest-first)', () => {
  test('renders Speaker: Text lines, drops blanks', () => {
    const out = buildRawBody([
      { speaker: '琳娜', text: '你好' },
      { speaker: '李平', text: '' }, // dropped
      { speaker: '琳娜', text: '请问这里是哪里？' },
    ]);
    expect(out).toBe('琳娜: 你好\n琳娜: 请问这里是哪里？');
  });
  test('empty turns → empty body', () => {
    expect(buildRawBody([])).toBe('');
  });
  test('? fallback when speaker empty', () => {
    const out = buildRawBody([{ speaker: '', text: 'hello' }]);
    expect(out).toBe('?: hello');
  });
});

// ──────────────────────────────────────────────────────────────────
describe('GlobalReflect prompts (S4)', () => {
  test('system prompt is generic + emits attribution / no-prefix instruction', () => {
    const sys = buildGlobalReflectSystemPrompt();
    expect(sys).toContain('跨人反思');
    expect(sys).toContain('归属句式');
    expect(sys).toContain('不要加前缀');
    expect(sys).not.toContain('武侠');
  });
  test('user body skips blank summaries; renders names in 「」', () => {
    const body = buildGlobalReflectUserBody({
      ownerName: '琳娜',
      pairs: [
        { name: '李平', summary: '他略显躲闪' },
        { name: 'X', summary: '' }, // dropped
        { name: '某甲', summary: 'multi\nline' }, // newlines collapsed to space
      ],
    });
    expect(body).toContain('反思的主人：琳娜');
    expect(body).toContain('「李平」：他略显躲闪');
    expect(body).not.toContain('「X」'); // skipped
    expect(body).toContain('「某甲」：multi line');
  });
  test('clampGlobalReflection trims to GLOBAL_REFLECTION_MAX_CHARS', () => {
    const big = 'x'.repeat(500);
    const out = clampGlobalReflection(big);
    expect(out.length).toBe(GLOBAL_REFLECTION_MAX_CHARS);
    expect(clampGlobalReflection('short')).toBe('short');
  });
});

// ──────────────────────────────────────────────────────────────────
describe('end-to-end parse: a realistic Grok output', () => {
  test('full 4-slot output parses cleanly', () => {
    const grokOut = [
      '往来印象：据其所见，他举止有些躲闪，似乎不擅与人对视；',
      '但她也注意到他偶尔偷偷打量她，让她略感不适。',
      '情绪变化：警惕 0.6',
      '好恶变化：-0.3',
      '违背设定：空',
    ].join('\n');
    expect(extractSlot(grokOut, SLOT_IMPRESSION)).toContain('据其所见');
    const emo = parseEmotion(extractSlot(grokOut, SLOT_EMOTION));
    expect(emo.label).toBe('警惕');
    expect(emo.intensity).toBeCloseTo(0.6, 5);
    expect(emo.isNeutral).toBe(false);
    expect(parseAffectionDelta(extractSlot(grokOut, SLOT_AFFECTION))).toBe(-0.3);
    expect(hasContradiction(extractSlot(grokOut, SLOT_CONTRADICTION))).toBe(false);
    expect(isTrivial(-0.3, false)).toBe(false); // big delta + non-neutral → apply
  });
  test('all-trivial 4-slot output → trivial=true (summary still folded, affect skipped)', () => {
    const grokOut = '往来印象：平淡寒暄一番。\n情绪变化：平静\n好恶变化：0\n违背设定：空';
    const emo = parseEmotion(extractSlot(grokOut, SLOT_EMOTION));
    const aff = parseAffectionDelta(extractSlot(grokOut, SLOT_AFFECTION));
    expect(emo.isNeutral).toBe(true);
    expect(aff).toBe(0);
    expect(isTrivial(aff, emo.isNeutral)).toBe(true);
    // summary remains extractable (the always-fold rule)
    expect(extractSlot(grokOut, SLOT_IMPRESSION)).toBe('平淡寒暄一番。');
  });
});
