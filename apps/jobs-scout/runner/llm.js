import { fetch, ProxyAgent } from 'undici';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export function createDispatcher(proxy) {
  if (!proxy) return undefined;
  if (proxy.startsWith('socks5://') || proxy.startsWith('socks5h://')) {
    return null;
  }
  return new ProxyAgent(proxy);
}

export async function callOpenRouter({ apiKey, model, messages, proxy, timeoutMs = 60000 }) {
  if (!apiKey) throw new Error('Missing OpenRouter API key.');
  const dispatcher = createDispatcher(proxy);
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
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/FrontMage/codex_helper',
      'X-Title': 'Jobs Scout'
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
