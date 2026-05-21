// P1-1B suite (§0.5): N2/S10 derived-window rule (anchor + last cap-1;
// ≤cap → all), N12 ring last-line marker, N3 no-under-render. Pure.

import {
  ringWindow,
  renderRing,
  renderWorkingMemory,
  renderEmotion,
  renderPerTarget,
} from './mindState';
import { buildContext } from './contextAssembler';
import { MEMORY_RING_CAP, EMOTION_FLOOR, EMOTION_HALFLIFE_MS } from '../constants';
import { Affect } from './affect';

const seq = (k: number) => Array.from({ length: k }, (_, i) => `m${i}`);

describe('ringWindow (N2/S10 — reproduces jynew anchor + last cap-1)', () => {
  test('k ≤ cap → all (identity, order preserved)', () => {
    expect(ringWindow(seq(10), 10)).toEqual(seq(10));
    expect(ringWindow(seq(1), 10)).toEqual(['m0']);
    expect(ringWindow([], 10)).toEqual([]);
  });

  test('k = 11, cap = 10 → {m0} ∪ {m2..m10} (jynew RemoveAt(1) steady state)', () => {
    expect(ringWindow(seq(11), 10)).toEqual([
      'm0',
      'm2',
      'm3',
      'm4',
      'm5',
      'm6',
      'm7',
      'm8',
      'm9',
      'm10',
    ]);
  });

  test('general k > cap: anchor pinned + exactly last (cap-1), length = cap', () => {
    for (const k of [12, 20, 100]) {
      const w = ringWindow(seq(k), MEMORY_RING_CAP);
      expect(w.length).toBe(MEMORY_RING_CAP);
      expect(w[0]).toBe('m0'); // anchor pinned (N2)
      expect(w[w.length - 1]).toBe(`m${k - 1}`); // most-recent included
      expect(w.slice(1)).toEqual(seq(k).slice(k - (MEMORY_RING_CAP - 1)));
    }
  });

  test('cap default = MEMORY_RING_CAP (10, N10) and guards cap ≤ 0', () => {
    expect(ringWindow(seq(15)).length).toBe(10);
    expect(ringWindow(seq(5), 0)).toEqual([]);
  });

  test('order pin: input MUST be oldest-first creation order (window mirrors it)', () => {
    // Mirrors api.messages.listMessages = .withIndex(conversationId).collect()
    // (no .order()) → ascending _creationTime. A reversed input would
    // corrupt anchor/most-recent; this pins the contract.
    const oldestFirst = seq(11);
    const w = ringWindow(oldestFirst, 10);
    expect(w[0]).toBe('m0'); // anchor = first created
    expect(w[w.length - 1]).toBe('m10'); // last = most recently created
  });
});

describe('renderRing (§5.5.3, N12 marker; N13 names not ids)', () => {
  test('empty → null (§ omission)', () => {
    expect(renderRing([])).toBeNull();
  });
  test('last line preceded by ［刚刚结束的对话］; speakers are display names', () => {
    const out = renderRing([
      { speaker: '琳娜', text: '你好' },
      { speaker: '李平', text: '你是谁' },
    ])!;
    const lines = out.split('\n');
    expect(lines[0]).toBe('最近交谈（最近2轮）：');
    expect(lines).toContain('［刚刚结束的对话］');
    // marker immediately precedes the final turn
    expect(lines[lines.indexOf('［刚刚结束的对话］') + 1]).toBe('李平：你是谁');
    expect(out).not.toMatch(/[a-z0-9]{20,}/i); // no raw engine id leaked
  });
});

describe('renderWorkingMemory (§5.1-5.3 omission + designer-scene note)', () => {
  test('all empty → null', () => {
    expect(renderWorkingMemory({})).toBeNull();
    expect(renderWorkingMemory({ situation: '  ', task: '', surroundings: undefined })).toBeNull();
  });
  test('renders only present fields under the non-canon scene header', () => {
    const s = renderWorkingMemory({ situation: '身处山谷', task: '找到出路' })!;
    expect(s).toContain('设计者设定的虚构情境');
    expect(s).toContain('情境：身处山谷');
    expect(s).toContain('任务：找到出路');
    expect(s).not.toContain('周遭');
  });
});

describe('renderEmotion (§5.4, N1 decay + N12 floor-omit)', () => {
  const emo = (p: Partial<Affect>): Affect => ({
    label: '警惕',
    value: 0.8,
    baseline: 0,
    lastSetMs: 0,
    halfLifeMs: EMOTION_HALFLIFE_MS,
    ...p,
  });
  test('unset → null', () => {
    expect(renderEmotion(null, 1000)).toBeNull();
    expect(renderEmotion(undefined, 1000)).toBeNull();
  });
  test('fresh (dt=0) → rendered with 1-decimal intensity + label', () => {
    const s = renderEmotion(emo({ value: 0.8 }), 0)!;
    expect(s).toBe('此刻心绪：警惕（强度 0.8，正缓缓平复）');
  });
  test('decayed below EMOTION_FLOOR → omitted (mood has passed, N12)', () => {
    // value 0.8 from 0; after enough half-lives Current < 0.12.
    const longAgo = Math.ceil(EMOTION_HALFLIFE_MS * 4); // 0.8*e^-4 ≈ 0.0147 < 0.12
    expect(renderEmotion(emo({ value: 0.8 }), longAgo)).toBeNull();
  });
  test('blank label still renders intensity-only form', () => {
    const s = renderEmotion(emo({ label: '', value: 0.5 }), 0)!;
    expect(s).toBe('此刻心绪：（强度 0.5，正缓缓平复）');
  });
  test('right at/above floor still renders', () => {
    const s = renderEmotion(emo({ label: '喜悦', value: EMOTION_FLOOR + 0.01 }), 0)!;
    expect(s).toContain('此刻心绪：喜悦');
  });
});

describe('renderPerTarget (§5.5 v3.5: affection decay + ring; semantic fields moved to §6)', () => {
  const aff = (p: Partial<Affect>): Affect => ({
    label: '',
    value: 0.5,
    baseline: 0,
    lastSetMs: 0,
    halfLifeMs: 900_000,
    ...p,
  });
  test('all empty → whole block omitted (no bare ·对 X· header)', () => {
    expect(renderPerTarget({ talkeeName: '李平' }, 0)).toBeNull();
    expect(renderPerTarget({ talkeeName: '李平', ring: [] }, 0)).toBeNull();
  });
  test('affection decayed at read time toward baseline (N1), 2-decimal', () => {
    // value 0.5, baseline 0, one half-life → 0.5*e^-1 ≈ 0.18
    const s = renderPerTarget({ talkeeName: '李平', affection: aff({}) }, 900_000)!;
    expect(s).toContain('·对 李平·');
    expect(s).toContain('当下好恶：0.18（向长期基线缓回）');
  });
  test('affection label rendered when present', () => {
    const s = renderPerTarget({ talkeeName: '李平', affection: aff({ label: '亲近', value: 0.5 }) }, 0)!;
    expect(s).toContain('当下好恶：0.50（亲近，向长期基线缓回）');
  });
  test('ring appended last within the per-target block (N12 marker)', () => {
    const s = renderPerTarget(
      { talkeeName: '李平', affection: aff({}), ring: [{ speaker: '李平', text: '在吗' }] },
      0,
    )!;
    expect(s.indexOf('当下好恶')).toBeLessThan(s.indexOf('最近交谈'));
    expect(s).toContain('［刚刚结束的对话］');
  });
});

describe('buildContext 1C: emotion in full+leave; per-target only in full', () => {
  const talker = { bioName: '琳娜', personality: '温文尔雅' };
  const talkee = { bioName: '李平', sex: '', ageText: '', appearance: '戴眼镜', surfaceManner: '' };
  const emotion: Affect = {
    label: '警惕',
    value: 0.8,
    baseline: 0,
    lastSetMs: 0,
    halfLifeMs: EMOTION_HALFLIFE_MS,
  };
  test('full: §5.4 emotion before §5.5 per-target', () => {
    const out = buildContext({
      profile: 'full',
      talker,
      talkee,
      shortTerm: {
        emotion,
        affection: { label: '', value: 0.5, baseline: 0, lastSetMs: 0, halfLifeMs: 900_000 },
        talkeeName: '李平',
        now: 0,
      },
    });
    expect(out).toContain('此刻心绪：警惕');
    expect(out.indexOf('此刻心绪')).toBeLessThan(out.indexOf('·对 李平·'));
  });
  test('leave lean: §2 + §5.4 emotion + ring-only, NO per-target affection block', () => {
    const out = buildContext({
      profile: 'leave',
      talker,
      talkee,
      shortTerm: {
        emotion,
        affection: { label: '', value: 0.9, baseline: 0, lastSetMs: 0, halfLifeMs: 900_000 },
        ring: [{ speaker: '李平', text: '再见' }],
        now: 0,
      },
    });
    expect(out).toContain('【我是谁 — 自我】');
    expect(out).toContain('此刻心绪：警惕');
    expect(out).toContain('最近交谈');
    expect(out).not.toContain('·对 '); // no per-target header in lean Leave
  });
});

describe('N3 no-under-render: a prompt built after a turn is persisted contains it', () => {
  test('full context includes the most-recent turn via the derived window', () => {
    // Simulate: 11 persisted messages; assembler builds AFTER the latest.
    const msgs = seq(11).map((id, i) => ({
      author: i % 2 === 0 ? 'npc' : 'pc',
      text: `turn ${i}`,
    }));
    const ring = ringWindow(msgs, MEMORY_RING_CAP).map((m) => ({
      speaker: m.author === 'npc' ? '琳娜' : '李平',
      text: m.text,
    }));
    const out = buildContext({
      profile: 'full',
      talker: { bioName: '琳娜', personality: '温文尔雅' },
      talkee: { bioName: '李平', sex: '', ageText: '', appearance: '戴眼镜', surfaceManner: '' },
      shortTerm: { ring },
    });
    // Use full speaker-prefixed lines (avoid 'turn 1' ⊂ 'turn 10').
    expect(out).toContain('琳娜：turn 10'); // most-recent turn rendered (m10, npc)
    expect(out).toContain('［刚刚结束的对话］');
    expect(out).toContain('琳娜：turn 0'); // anchor preserved (m0, npc)
    expect(out).not.toContain('李平：turn 1'); // evicted: k=11 drops m1 (pc)
  });
});
