import { fetch, ProxyAgent } from 'undici';
import fs from 'node:fs';

const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const OPENROUTER_URL = `${OPENROUTER_BASE_URL}/chat/completions`;
const OPENROUTER_REFERER =
  process.env.OPENROUTER_REFERER || 'https://github.com/FrontMage/codex_helper';
const OPENROUTER_TITLE = process.env.OPENROUTER_TITLE || 'Jobs Scout';
const OPENROUTER_API_KEY_PATH = process.env.OPENROUTER_API_KEY_PATH || '';

function resolveProxy(proxy) {
  if (proxy) return proxy;
  return (
    process.env.OPENROUTER_PROXY ||
    process.env.OPENAI_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    ''
  );
}

function loadApiKey(explicit) {
  if (explicit) return explicit.trim();
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  if (!OPENROUTER_API_KEY_PATH) return '';
  const raw = fs.readFileSync(OPENROUTER_API_KEY_PATH, 'utf8');
  const cleaned = raw
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  return cleaned[0] || '';
}

export function createDispatcher(proxy) {
  if (!proxy) return undefined;
  if (proxy.startsWith('socks5://') || proxy.startsWith('socks5h://')) {
    return null;
  }
  return new ProxyAgent(proxy);
}

export async function callOpenRouter({ apiKey, model, messages, proxy, timeoutMs = 60000 }) {
  const resolvedKey = loadApiKey(apiKey);
  if (!resolvedKey) throw new Error('Missing OpenRouter API key.');
  const resolvedProxy = resolveProxy(proxy);
  const dispatcher = createDispatcher(resolvedProxy);
  if (dispatcher === null) {
    throw new Error('SOCKS5 proxy not supported for LLM; use HTTP/HTTPS proxy.');
  }

  const body = {
    model,
    messages,
    temperature: 0.2
  };

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resolvedKey}`,
      'Content-Type': 'application/json',
      ...(OPENROUTER_REFERER ? { 'HTTP-Referer': OPENROUTER_REFERER } : {}),
      ...(OPENROUTER_TITLE ? { 'X-Title': OPENROUTER_TITLE } : {})
    },
    body: JSON.stringify(body),
    dispatcher,
    signal: AbortSignal.timeout(timeoutMs)
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OpenRouter error ${res.status}: ${text}`);
  }

  const data = JSON.parse(text);
  const content = data?.choices?.[0]?.message?.content || '';
  return content;
}

export function extractJson(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}
