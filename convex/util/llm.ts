// LLM wrapper — P1-1D simplified.
//
// HumanMemory_AITown_Plan v3.1 eliminates embeddings entirely (S12 →
// finally landed in 1D). All embedding constants, fetchEmbedding /
// fetchEmbeddingBatch / ollamaFetchEmbedding / embeddingsEnabled /
// detectMismatchedLLMProvider / EMBEDDING_DIMENSION / per-provider
// embedding-model fields / Ollama embedding-auto-pull are removed.
//
// Surviving surface: provider config (chat-only), chatCompletion
// (streaming + non-streaming), retryWithBackoff, the OpenAI-shaped
// LLMMessage / CreateChatCompletionRequest / CreateChatCompletionResponse
// type bag, and the streaming ChatCompletionContent class.

export interface LLMConfig {
  provider: 'openai' | 'together' | 'ollama' | 'custom' | 'grok';
  url: string; // Bare host; chatCompletion appends '/v1/chat/completions'.
  chatModel: string;
  stopWords: string[];
  apiKey: string | undefined;
}

export function getLLMConfig(): LLMConfig {
  const provider = process.env.LLM_PROVIDER;
  if (provider ? provider === 'openai' : process.env.OPENAI_API_KEY) {
    return {
      provider: 'openai',
      url: 'https://api.openai.com',
      chatModel: process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o-mini',
      stopWords: [],
      apiKey: process.env.OPENAI_API_KEY,
    };
  }
  if (process.env.TOGETHER_API_KEY) {
    return {
      provider: 'together',
      url: 'https://api.together.xyz',
      chatModel: process.env.TOGETHER_CHAT_MODEL ?? 'meta-llama/Llama-3-8b-chat-hf',
      stopWords: ['<|eot_id|>'],
      apiKey: process.env.TOGETHER_API_KEY,
    };
  }
  // xAI Grok (OpenAI-compatible). Placed BEFORE the LLM_API_URL custom
  // branch. P1-1D: embeddings field removed since no embedding path
  // remains in the codebase.
  if (provider ? provider === 'grok' : process.env.XAI_API_KEY) {
    return {
      provider: 'grok',
      url: 'https://api.x.ai',
      chatModel:
        process.env.GROK_CHAT_MODEL ?? process.env.LLM_MODEL ?? 'grok-4.20-non-reasoning',
      stopWords: [],
      apiKey: process.env.XAI_API_KEY,
    };
  }
  if (process.env.LLM_API_URL) {
    const apiKey = process.env.LLM_API_KEY;
    const url = process.env.LLM_API_URL;
    const chatModel = process.env.LLM_MODEL;
    if (!chatModel) throw new Error('LLM_MODEL is required');
    return {
      provider: 'custom',
      url,
      chatModel,
      stopWords: [],
      apiKey,
    };
  }
  // Assume Ollama (chat only; embeddings removed in P1-1D).
  return {
    provider: 'ollama',
    url: process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434',
    chatModel: process.env.OLLAMA_MODEL ?? 'llama3',
    stopWords: ['<|eot_id|>'],
    apiKey: undefined,
  };
}

const AuthHeaders = (): Record<string, string> =>
  getLLMConfig().apiKey
    ? {
        Authorization: 'Bearer ' + getLLMConfig().apiKey,
      }
    : {};

// Overload for non-streaming
export async function chatCompletion(
  body: Omit<CreateChatCompletionRequest, 'model'> & {
    model?: CreateChatCompletionRequest['model'];
  } & {
    stream?: false | null | undefined;
  },
): Promise<{ content: string; retries: number; ms: number }>;
// Overload for streaming
export async function chatCompletion(
  body: Omit<CreateChatCompletionRequest, 'model'> & {
    model?: CreateChatCompletionRequest['model'];
  } & {
    stream?: true;
  },
): Promise<{ content: ChatCompletionContent; retries: number; ms: number }>;
export async function chatCompletion(
  body: Omit<CreateChatCompletionRequest, 'model'> & {
    model?: CreateChatCompletionRequest['model'];
  },
) {
  const config = getLLMConfig();
  body.model = body.model ?? config.chatModel;
  const stopWords = body.stop ? (typeof body.stop === 'string' ? [body.stop] : body.stop) : [];
  if (config.stopWords) stopWords.push(...config.stopWords);
  console.log(body);
  const {
    result: content,
    retries,
    ms,
  } = await retryWithBackoff(async () => {
    const result = await fetch(config.url + '/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...AuthHeaders(),
      },

      body: JSON.stringify(body),
    });
    if (!result.ok) {
      const error = await result.text();
      console.error({ error });
      throw {
        retry: result.status === 429 || result.status >= 500,
        error: new Error(`Chat completion failed with code ${result.status}: ${error}`),
      };
    }
    if (body.stream) {
      return new ChatCompletionContent(result.body!, stopWords);
    } else {
      const json = (await result.json()) as CreateChatCompletionResponse;
      const content = json.choices[0].message?.content;
      if (content === undefined) {
        throw new Error('Unexpected result from OpenAI-shaped response: ' + JSON.stringify(json));
      }
      console.log(content);
      return content;
    }
  });

  return {
    content,
    retries,
    ms,
  };
}

// Retry after this much time, based on the retry number.
const RETRY_BACKOFF = [1000, 10_000, 20_000]; // In ms
const RETRY_JITTER = 100; // In ms
type RetryError = { retry: boolean; error: any };

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
): Promise<{ retries: number; result: T; ms: number }> {
  let i = 0;
  for (; i <= RETRY_BACKOFF.length; i++) {
    try {
      const start = Date.now();
      const result = await fn();
      const ms = Date.now() - start;
      return { result, retries: i, ms };
    } catch (e) {
      const retryError = e as RetryError;
      if (i < RETRY_BACKOFF.length) {
        if (retryError.retry) {
          console.log(
            `Attempt ${i + 1} failed, waiting ${RETRY_BACKOFF[i]}ms to retry...`,
            Date.now(),
          );
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_BACKOFF[i] + RETRY_JITTER * Math.random()),
          );
          continue;
        }
      }
      if (retryError.error) throw retryError.error;
      else throw e;
    }
  }
  throw new Error('Unreachable');
}

// ──────────────────────────────────────────────────────────────────
// OpenAI-shaped chat-message + request/response types
// ──────────────────────────────────────────────────────────────────
export interface LLMMessage {
  content: string | null;
  role: 'system' | 'user' | 'assistant' | 'function';
  name?: string;
  function_call?: {
    name: string;
    arguments: string;
  };
}

interface CreateChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index?: number;
    message?: {
      role: 'system' | 'user' | 'assistant';
      content: string;
    };
    finish_reason?: string;
  }[];
  usage?: {
    completion_tokens: number;
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface CreateChatCompletionRequest {
  model: string;
  messages: LLMMessage[];
  temperature?: number | null;
  top_p?: number | null;
  n?: number | null;
  stream?: boolean | null;
  stop?: Array<string> | string;
  max_tokens?: number;
  presence_penalty?: number | null;
  frequency_penalty?: number | null;
  logit_bias?: object | null;
  user?: string;
  tools?: {
    type: 'function';
    function: { name: string; description?: string; parameters: object };
  }[];
  tool_choice?:
    | 'none'
    | 'auto'
    | { type: 'function'; function: { name: string } };
}

// ──────────────────────────────────────────────────────────────────
// Streaming reader (used when chatCompletion is called with stream:true)
// ──────────────────────────────────────────────────────────────────
const suffixOverlapsPrefix = (s1: string, s2: string) => {
  for (let i = 1; i <= Math.min(s1.length, s2.length); i++) {
    const suffix = s1.substring(s1.length - i);
    const prefix = s2.substring(0, i);
    if (suffix === prefix) {
      return true;
    }
  }
  return false;
};

export class ChatCompletionContent {
  private readonly body: ReadableStream<Uint8Array>;
  private readonly stopWords: string[];

  constructor(body: ReadableStream<Uint8Array>, stopWords: string[]) {
    this.body = body;
    this.stopWords = stopWords;
  }

  async *readInner() {
    for await (const data of this.splitStream(this.body)) {
      if (data.startsWith('data: ')) {
        try {
          const json = JSON.parse(data.substring('data: '.length)) as {
            choices: { delta: { content?: string } }[];
          };
          if (json.choices[0].delta.content) {
            yield json.choices[0].delta.content;
          }
        } catch (e) {
          // e.g. the last chunk is [DONE] which is not valid JSON.
        }
      }
    }
  }

  async *read() {
    let lastFragment = '';
    for await (const data of this.readInner()) {
      lastFragment += data;
      let hasOverlap = false;
      for (const stopWord of this.stopWords) {
        const idx = lastFragment.indexOf(stopWord);
        if (idx >= 0) {
          yield lastFragment.substring(0, idx);
          return;
        }
        if (suffixOverlapsPrefix(lastFragment, stopWord)) {
          hasOverlap = true;
        }
      }
      if (hasOverlap) continue;
      yield lastFragment;
      lastFragment = '';
    }
    yield lastFragment;
  }

  async readAll() {
    let allContent = '';
    for await (const chunk of this.read()) {
      allContent += chunk;
    }
    return allContent;
  }

  async *splitStream(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    let lastFragment = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          if (lastFragment !== '') {
            yield lastFragment;
          }
          break;
        }
        const data = new TextDecoder().decode(value);
        lastFragment += data;
        const parts = lastFragment.split('\n\n');
        for (let i = 0; i < parts.length - 1; i += 1) {
          yield parts[i];
        }
        lastFragment = parts[parts.length - 1];
      }
    } finally {
      reader.releaseLock();
    }
  }
}
