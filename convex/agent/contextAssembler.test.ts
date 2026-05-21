// P1-1A ContextAssembler suite (§0.5): N9 anti-omniscience seal,
// section omission, fixed order, char budgets. Pure — no Convex.

import { buildContext, __test } from './contextAssembler';
import { SECT_SELFBIO_BUDGET, SECT_TALKEE_BUDGET } from '../constants';

const { buildSelfBio, buildTalkeeSurfaceSealed, appendSection } = __test;

describe('§2 buildSelfBio (talker-only)', () => {
  test('null / empty personality → omitted (null)', () => {
    expect(buildSelfBio(null)).toBeNull();
    expect(buildSelfBio({ bioName: '琳娜', personality: '   ' })).toBeNull();
  });
  test('valid → header + name + personality', () => {
    const s = buildSelfBio({ bioName: '琳娜', personality: '温文尔雅' })!;
    expect(s).toContain('【我是谁 — 自我】');
    expect(s).toContain('姓名：琳娜');
    expect(s).toContain('性情：温文尔雅');
  });
});

describe('§3 buildTalkeeSurfaceSealed (N9 anti-omniscience seal)', () => {
  test('both appearance AND manner empty → §3 omitted entirely (no lone 性别 line)', () => {
    expect(buildTalkeeSurfaceSealed('李平', '', '', '', '')).toBeNull();
    expect(buildTalkeeSurfaceSealed('李平', '男', '20岁', '   ', '  ')).toBeNull();
  });
  test('appearance only → no 气度 line', () => {
    const s = buildTalkeeSurfaceSealed('李平', '', '', '戴眼镜', '')!;
    expect(s).toContain('外貌：戴眼镜');
    expect(s).not.toContain('气度');
  });
  test('manner only → no 外貌 line', () => {
    const s = buildTalkeeSurfaceSealed('李平', '', '', '', '不起眼')!;
    expect(s).toContain('气度：不起眼');
    expect(s).not.toContain('外貌');
  });
  test('empty sex/ageText (PC degrade) → no 性别/年龄 lines', () => {
    const s = buildTalkeeSurfaceSealed('李平', '', '', '戴眼镜', '不起眼')!;
    expect(s).toContain('姓名：李平');
    expect(s).not.toContain('性别');
    expect(s).not.toContain('年龄');
  });
  test('full surface → all four lines, no private fields possible (signature seal)', () => {
    const s = buildTalkeeSurfaceSealed('琳娜', '女', '18岁', '黑直发', '温文尔雅')!;
    expect(s).toContain('姓名：琳娜');
    expect(s).toContain('性别：女');
    expect(s).toContain('年龄：18岁');
    expect(s).toContain('外貌：黑直发');
    expect(s).toContain('气度：温文尔雅');
  });
});

describe('appendSection (budget + omission)', () => {
  test('null/blank contributes nothing', () => {
    const p: string[] = [];
    appendSection(p, null, 100);
    appendSection(p, '   ', 100);
    expect(p).toEqual([]);
  });
  test('over-budget is hard-truncated to budget chars', () => {
    const p: string[] = [];
    appendSection(p, 'x'.repeat(1000), 600);
    expect(p[0].length).toBe(600);
  });
});

describe('buildContext (fixed order, profiles)', () => {
  const talker = { bioName: '琳娜', personality: '温文尔雅' };
  const talkee = {
    bioName: '李平',
    sex: '',
    ageText: '',
    appearance: '戴厚眼镜',
    surfaceManner: '不起眼',
  };

  test('full → §2 precedes §3; §1/§4 structurally absent', () => {
    const out = buildContext({ profile: 'full', talker, talkee });
    const i2 = out.indexOf('【我是谁 — 自我】');
    const i3 = out.indexOf('【对面是谁 — 初见印象】');
    expect(i2).toBeGreaterThanOrEqual(0);
    expect(i3).toBeGreaterThan(i2); // §2 before §3
    expect(out).not.toContain('世界'); // no §1 WorldCodex
    expect(out).not.toContain('长期记忆'); // no §4 Dossier
  });

  test('empty talker + talkee → empty block (clean degrade)', () => {
    expect(buildContext({ profile: 'full', talker: null, talkee: null })).toBe('');
  });

  test('leave profile → §2 only, no §3', () => {
    const out = buildContext({ profile: 'leave', talker, talkee });
    expect(out).toContain('【我是谁 — 自我】');
    expect(out).not.toContain('【对面是谁 — 初见印象】');
  });

  test('budgets honored end-to-end', () => {
    const big = { bioName: 'X', personality: 'p'.repeat(5000) };
    const out = buildContext({ profile: 'full', talker: big, talkee: null });
    expect(out.length).toBeLessThanOrEqual(SECT_SELFBIO_BUDGET);
    expect(SECT_TALKEE_BUDGET).toBe(400); // constant pinned (N10)
  });
});
