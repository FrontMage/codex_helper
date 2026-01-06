import { ProxyAgent, setGlobalDispatcher } from 'undici';
import fs from 'fs';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_API_KEY_PATH = process.env.OPENROUTER_API_KEY_PATH || '/Users/xinbiguo/Documents/openaikey';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-5.1-codex';
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const OPENROUTER_REFERER = process.env.OPENROUTER_REFERER || '';
const OPENROUTER_TITLE = process.env.OPENROUTER_TITLE || 'smartedu-runner';
const OPENROUTER_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS || '45000');
const OPENAI_PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || 'http://localhost:8080';
const DEBUG_LLM = process.env.DEBUG_LLM === '1';
const PROMPT = process.env.CHECK_PROMPT || '披萨怎么做？';

function loadApiKey() {
  if (OPENROUTER_API_KEY) return OPENROUTER_API_KEY.trim();
  const raw = fs.readFileSync(OPENROUTER_API_KEY_PATH, 'utf8');
  const cleaned = raw
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const key = cleaned[0];
  if (!key) throw new Error('OpenRouter API key is empty.');
  return key;
}

if (OPENAI_PROXY) {
  setGlobalDispatcher(new ProxyAgent(OPENAI_PROXY));
}

async function rawCheck() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
  const resp = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${loadApiKey()}`,
      'Content-Type': 'application/json',
      ...(OPENROUTER_REFERER ? { 'HTTP-Referer': OPENROUTER_REFERER } : {}),
      ...(OPENROUTER_TITLE ? { 'X-Title': OPENROUTER_TITLE } : {})
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: 'You are a health check.' },
        { role: 'user', content: PROMPT }
      ]
    }),
    signal: controller.signal
  }).finally(() => clearTimeout(timeoutId));

  const text = await resp.text();
  console.log('Raw status:', resp.status);
  console.log('Raw body:', text.slice(0, 4000));
  if (!resp.ok) return false;
  try {
    const data = JSON.parse(text);
    const content = data?.choices?.[0]?.message?.content || '';
    console.log('Raw OK:', OPENROUTER_MODEL);
    console.log('Prompt:', PROMPT);
    console.log('Reply:', content.trim());
  } catch {
    // Ignore parse errors; raw body already printed.
  }
  return true;
}

try {
  const ok = await rawCheck();
  if (!ok) {
    console.error('OpenRouter check failed: non-200 response');
    process.exit(1);
  }
} catch (err) {
  if (DEBUG_LLM && err?.name === 'AbortError') {
    console.error('OpenRouter check failed: request timed out');
  } else {
    console.error('OpenRouter check failed:', err?.message || String(err));
  }
  process.exit(1);
}
