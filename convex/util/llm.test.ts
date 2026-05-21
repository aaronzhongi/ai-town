// P1-1D: embeddings removed; embeddingsEnabled tests dropped.
// Surviving llm-config tests: provider routing for Grok (the active
// provider for the human-memory port) and default Ollama fallback.

import { getLLMConfig } from './llm';

const saved: Record<string, string | undefined> = {};
const keys = [
  'LLM_PROVIDER',
  'XAI_API_KEY',
  'OPENAI_API_KEY',
  'TOGETHER_API_KEY',
  'LLM_API_URL',
  'LLM_MODEL',
  'GROK_CHAT_MODEL',
];

beforeEach(() => {
  for (const k of keys) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('getLLMConfig — provider routing (P1-1D)', () => {
  test('LLM_PROVIDER=grok → grok branch with bare-host url', () => {
    process.env.LLM_PROVIDER = 'grok';
    process.env.XAI_API_KEY = 'xai-test';
    const cfg = getLLMConfig();
    expect(cfg.provider).toBe('grok');
    // chatCompletion appends '/v1/chat/completions'; url must NOT include /v1.
    expect(cfg.url).toBe('https://api.x.ai');
    expect(cfg.chatModel).toBe('grok-4.20-non-reasoning');
    expect(cfg.apiKey).toBe('xai-test');
  });

  test('GROK_CHAT_MODEL overrides default', () => {
    process.env.LLM_PROVIDER = 'grok';
    process.env.XAI_API_KEY = 'xai-test';
    process.env.GROK_CHAT_MODEL = 'grok-foo';
    expect(getLLMConfig().chatModel).toBe('grok-foo');
  });

  test('Grok branch precedes LLM_API_URL custom branch (no 1A-era throw reachable)', () => {
    process.env.LLM_PROVIDER = 'grok';
    process.env.XAI_API_KEY = 'xai-test';
    process.env.LLM_API_URL = 'http://should-not-be-used';
    expect(() => getLLMConfig()).not.toThrow();
    expect(getLLMConfig().provider).toBe('grok');
  });

  test('No env set → default Ollama (chat-only post-1D)', () => {
    const cfg = getLLMConfig();
    expect(cfg.provider).toBe('ollama');
    expect(cfg.chatModel.length).toBeGreaterThan(0);
  });

  test('LLMConfig no longer carries embeddingModel field (P1-1D)', () => {
    process.env.LLM_PROVIDER = 'grok';
    process.env.XAI_API_KEY = 'xai-test';
    const cfg = getLLMConfig() as unknown as Record<string, unknown>;
    expect(cfg.embeddingModel).toBeUndefined();
  });
});
