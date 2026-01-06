import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import puppeteer from 'puppeteer-core';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

const DEFAULT_COURSE_URL = 'https://basic.smartedu.cn/teacherTraining/courseDetail?courseId=cb134d8b-ebe5-4953-8c2c-10d27b45b8dc&tag=2025%E5%B9%B4%E2%80%9C%E6%9A%91%E6%9C%9F%E6%95%99%E5%B8%88%E7%A0%94%E4%BF%AE%E2%80%9D%E4%B8%93%E9%A2%98&channelId=&libraryId=bb042e69-9a11-49a1-af22-0c3fab2e92b9&breadcrumb=2025%E5%B9%B4%E2%80%9C%E6%9A%91%E6%9C%9F%E6%95%99%E5%B8%88%E7%A0%94%E4%BF%AE%E2%80%9D%E4%B8%93%E9%A2%98&resourceId=d2bdf509-3049-4487-a985-eed857ca003a';
const getArg = (name) => {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const value = process.argv[idx + 1];
  return value || null;
};
const COURSE_URL = getArg('course-url') || process.env.COURSE_URL || DEFAULT_COURSE_URL;
const START_URL = getArg('start-url') || process.env.START_URL || 'https://auth.smartedu.cn/uias/login';
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const USER_DATA_DIR = process.env.USER_DATA_DIR || path.join(os.homedir(), '.chrome-smartedu-manual');
const PLAYBACK_RATE = Number(process.env.PLAYBACK_RATE || '2');
const HEADLESS = process.env.HEADLESS === '1';
const HIDE_AUTOMATION_INFOBAR = process.env.HIDE_AUTOMATION_INFOBAR === '1';
const COMPLETION_TIMEOUT_MS = Number(process.env.COMPLETION_TIMEOUT_MS || `${3 * 60 * 60 * 1000}`);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || '10000');
const MAX_PLAY_ATTEMPTS = Number(process.env.MAX_PLAY_ATTEMPTS || '3');
const LOGIN_USERNAME = process.env.LOGIN_USERNAME || '15171503717';
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || '54zzq1107';
const DEBUG_ITEMS = process.env.DEBUG_ITEMS === '1';
const DEBUG_LLM = process.env.DEBUG_LLM === '1';
const OPENROUTER_API_KEY_PATH = process.env.OPENROUTER_API_KEY_PATH
  || process.env.OPENAI_API_KEY_PATH
  || '/Users/xinbiguo/Documents/openaikey';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || process.env.OPENAI_MODEL || 'openai/gpt-5.1-codex';
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const OPENROUTER_REFERER = process.env.OPENROUTER_REFERER || '';
const OPENROUTER_TITLE = process.env.OPENROUTER_TITLE || 'smartedu-runner';
const OPENAI_PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || 'http://localhost:8080';
const OPENROUTER_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS || '45000');
const MAX_CANDIDATES = Number(process.env.MAX_CANDIDATES || '300');
const LLM_MINIMAL_PAYLOAD = process.env.LLM_MINIMAL_PAYLOAD !== '0';
const LLM_FALLBACK = process.env.LLM_FALLBACK !== '0';
const LLM_DUMP_CANDIDATES = process.env.LLM_DUMP_CANDIDATES === '1';
const DUMP_ON_ERROR = process.env.DUMP_ON_ERROR !== '0';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForUserLogin() {
  console.log('Please complete login (including captcha) in the browser window.');
  console.log('Press Enter here when login is done.');
  await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', () => {
      rl.close();
      resolve();
    });
  });
}

async function fillLoginForm(page, username, password) {
  await page.waitForSelector('input', { timeout: 15000 });
  await page.evaluate((user, pass) => {
    const inputs = Array.from(document.querySelectorAll('input'));
    const pick = (predicates) => inputs.find((el) => predicates.some((fn) => fn(el)));
    const byType = (type) => (el) => (el.getAttribute('type') || '').toLowerCase() === type;
    const byPlaceholder = (pattern) => (el) => pattern.test(el.getAttribute('placeholder') || '');

    const userInput = pick([
      byType('tel'),
      byType('text'),
      byPlaceholder(/手机|账号|手机号|邮箱/i)
    ]);
    const passInput = pick([byType('password')]);

    const setValue = (el, value) => {
      if (!el) return;
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    setValue(userInput, user);
    setValue(passInput, pass);
  }, username, password);
}

async function ensureLogin(page) {
  const isLoginPage = (url) => url.includes('auth.smartedu.cn/uias/login');
  if (!isLoginPage(page.url())) return;
  await fillLoginForm(page, LOGIN_USERNAME, LOGIN_PASSWORD);
  await waitForUserLogin();
}

async function closeModalIfPresent(page, texts) {
  for (const frame of page.frames()) {
    try {
      await frame.evaluate((targets) => {
        const elements = Array.from(document.querySelectorAll('button,div,span,a'));
        const match = elements.find((el) => targets.includes((el.textContent || '').trim()));
        if (match) match.click();
      }, texts);
    } catch {
      // Ignore inaccessible frames.
    }
  }
}

async function getVideoFrame(page) {
  for (const frame of page.frames()) {
    try {
      if (await frame.$('video')) return frame;
    } catch {
      // Ignore cross-origin evaluation errors.
    }
  }
  return page;
}

async function clickByText(page, text) {
  for (const frame of page.frames()) {
    try {
      const clicked = await frame.evaluate((targetText) => {
        const node = Array.from(document.querySelectorAll('a,button,div,span'))
          .find((el) => (el.innerText || '').trim() === targetText);
        if (!node) return false;
        const clickable = node.closest('a,button,[role="button"],[role="link"],div') || node;
        clickable.scrollIntoView({ block: 'center', inline: 'center' });
        clickable.click();
        return true;
      }, text);
      if (clicked) return true;
    } catch {
      // Ignore inaccessible frames.
    }
  }
  return false;
}

async function tryClickVideo(page, frame) {
  const handle = await frame.$('video');
  if (!handle) return false;
  const box = await handle.boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount: 1 });
  return true;
}

async function clickPlayButton(frame) {
  return frame.evaluate(() => {
    const selectors = [
      '.vjs-big-play-button',
      '.vjs-play-control',
      '.xgplayer-start',
      '[aria-label*="Play"]',
      '[title*="播放"]',
      '[aria-label*="播放"]'
    ];
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) {
        node.click();
        return true;
      }
    }
    return false;
  });
}

async function ensureVideoPlaying(page, rate) {
  const frame = await getVideoFrame(page);
  await frame.waitForSelector('video', { timeout: 30000 });
  let lastTime = 0;

  for (let attempt = 1; attempt <= MAX_PLAY_ATTEMPTS; attempt += 1) {
    await frame.evaluate((playbackRate) => {
      const video = document.querySelector('video');
      if (!video) return;
      video.muted = true;
      video.volume = 0;
      video.playbackRate = playbackRate;
    }, rate);

    const started = await frame.evaluate(async () => {
      const video = document.querySelector('video');
      if (!video) return { ok: false, reason: 'no_video' };
      try {
        await video.play();
      } catch {
        return { ok: false, reason: 'play_failed' };
      }
      return { ok: true };
    });

    if (!started.ok) {
      if (attempt === MAX_PLAY_ATTEMPTS) throw new Error(`Playback failed: ${started.reason}`);
    }

    await sleep(2000);
    const status = await frame.evaluate((prevTime) => {
      const video = document.querySelector('video');
      if (!video) return { ok: false };
      return {
        ok: true,
        paused: video.paused,
        currentTime: Number(video.currentTime || 0),
        duration: Number(video.duration || 0),
        playbackRate: video.playbackRate,
        advanced: Number(video.currentTime || 0) > prevTime + 0.2
      };
    }, lastTime);

    if (status.ok && !status.paused && status.currentTime > 0 && status.advanced) {
      return status;
    }

    lastTime = status.currentTime || lastTime;
    if (attempt === 1) {
      await tryClickVideo(page, frame);
    } else if (attempt === 2) {
      await clickPlayButton(frame);
    } else {
      await page.keyboard.press('Space');
    }
  }

  throw new Error('Video did not start playing.');
}

let proxyInitialized = false;

function initProxy() {
  if (proxyInitialized) return;
  if (OPENAI_PROXY) {
    setGlobalDispatcher(new ProxyAgent(OPENAI_PROXY));
  }
  proxyInitialized = true;
}

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

function sanitizeText(value) {
  if (!value) return '';
  return value
    .replace(/\s+/g, ' ')
    .replace(/[0-9]{6,}/g, '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
    .trim()
    .slice(0, 80);
}

function getDumpPaths(label) {
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseDir = path.resolve('recordings', 'dumps');
  fs.mkdirSync(baseDir, { recursive: true });
  const base = path.join(baseDir, `${stamp}-${safeLabel}`);
  return { jsonPath: `${base}.json`, screenshotPath: `${base}.png` };
}

async function dumpPlaybackState(page, item, label, stage) {
  const { jsonPath, screenshotPath } = getDumpPaths(`${stage}-${label}`);
  const frameSummaries = [];

  for (const frame of page.frames()) {
    try {
      const hasVideo = !!await frame.$('video');
      frameSummaries.push({ url: frame.url(), hasVideo });
    } catch {
      frameSummaries.push({ url: frame.url(), hasVideo: false, error: 'inaccessible' });
    }
  }

  let videoDetails = null;
  try {
    const videoFrame = await getVideoFrame(page);
    videoDetails = await videoFrame.evaluate(() => {
      const video = document.querySelector('video');
      if (!video) return null;
      return {
        currentTime: Number(video.currentTime || 0),
        duration: Number(video.duration || 0),
        paused: video.paused,
        ended: video.ended,
        readyState: video.readyState,
        networkState: video.networkState,
        playbackRate: video.playbackRate,
        src: video.currentSrc || video.src || '',
        error: video.error ? { code: video.error.code, message: video.error.message || '' } : null
      };
    });
  } catch {
    videoDetails = { error: 'video inspect failed' };
  }

  const dump = {
    stage,
    label,
    url: page.url(),
    courseUrl: COURSE_URL,
    item,
    frames: frameSummaries,
    video: videoDetails
  };

  fs.writeFileSync(jsonPath, JSON.stringify(dump, null, 2));
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch {
    // Ignore screenshot failures (e.g. secure contexts).
  }
  console.log(`Dumped state to ${jsonPath}`);
}

async function callOpenRouter(messages) {
  initProxy();
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
      messages
    })
  });

  const bodyText = await resp.text();
  if (!resp.ok) {
    throw new Error(`OpenRouter request failed: ${resp.status} ${bodyText}`.trim());
  }
  const data = JSON.parse(bodyText);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenRouter response missing content.');
  return text;
}

function extractJson(text) {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Failed to parse OpenAI JSON response.');
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

async function collectCandidates(page) {
  const frames = page.frames();
  const candidates = [];

  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i];
    try {
      const frameCandidates = await frame.evaluate((limit) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const items = [];
        const seen = new Set();
        let order = 0;

        const isVisible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const isIgnoredContainer = (el) => !!el.closest('header,footer,nav');

        const toContext = (el) => {
          const ctx = el.closest('[class*="resource"],[class*="course"],[class*="catalog"],[class*="list"],[id*="resource"],[id*="course"],[id*="catalog"]');
          const text = normalize(ctx ? ctx.textContent : el.textContent);
          return text.slice(0, 160);
        };

        const toResourceId = (href) => {
          if (!href) return '';
          const match = href.match(/[?&]resourceId=([^&]+)/);
          return match ? decodeURIComponent(match[1]) : '';
        };

        const add = (el, reason) => {
          if (!el) return;
          const text = normalize(el.textContent || el.getAttribute('title') || el.getAttribute('aria-label'));
          if (isIgnoredContainer(el)) return;
          if (!text && !el.getAttribute('href') && !el.getAttribute('data-resource-id')) return;
          const rawHref = el.getAttribute('href') || '';
          const href = el.href || rawHref;
          const dataKey = el.getAttribute('data-resource-id')
            || el.getAttribute('data-resourceid')
            || el.getAttribute('data-resid')
            || el.getAttribute('data-resource')
            || '';
          const resourceId = dataKey || toResourceId(href);
          const key = resourceId || href || text;
          if (!key || seen.has(key)) return;
          seen.add(key);
          items.push({
            domIndex: order++,
            text,
            href,
            resourceId,
            dataKey,
            tag: el.tagName,
            id: el.id || '',
            className: typeof el.className === 'string'
              ? el.className.split(/\s+/).slice(0, 6).join(' ')
              : '',
            context: toContext(el),
            reason
          });
        };

        const primarySelectors = [
          'a[href*="resourceId="]',
          '[data-resource-id]',
          '[data-resourceid]',
          '[data-resid]',
          '[data-resource]'
        ];

        primarySelectors.forEach((selector) => {
          document.querySelectorAll(selector).forEach((el) => add(el, selector));
        });

        const keywordMatches = ['课程目录', '课程大纲', '目录', '章节', '课时', '课程'];
        const headingNodes = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,div,span,p'))
          .filter((el) => {
            const text = normalize(el.textContent);
            return text && keywordMatches.some((word) => text.includes(word));
          })
          .slice(0, 6);

        const outlineContainers = new Set();
        headingNodes.forEach((node) => {
          const container = node.closest('[class*="catalog"],[class*="outline"],[class*="resource"],[class*="list"],section,div');
          if (container) outlineContainers.add(container);
        });
        document.querySelectorAll('[class*="catalog"],[class*="outline"],[class*="resource"],[class*="list"],[id*="catalog"],[id*="outline"]').forEach((node) => {
          outlineContainers.add(node);
        });

        outlineContainers.forEach((container) => {
          const outlineItems = Array.from(container.querySelectorAll('li,div,span,a,p,button'))
            .filter((el) => {
              if (!isVisible(el)) return false;
              if (isIgnoredContainer(el)) return false;
              const text = normalize(el.textContent || '');
              if (text.length < 2 || text.length > 80) return false;
              if (keywordMatches.some((word) => text === word)) return false;
              return true;
            });
          outlineItems.slice(0, limit).forEach((el) => add(el, 'outline'));
        });

        if (items.length < 3) {
          const fallback = Array.from(document.querySelectorAll('a,button,[role="button"],[role="link"],[tabindex]'));
          for (const el of fallback) {
            if (items.length >= limit) break;
            if (!isVisible(el)) continue;
            const text = normalize(el.textContent || el.getAttribute('aria-label'));
            if (text.length < 2 || text.length > 80) continue;
            add(el, 'fallback');
          }
        }

        return items.slice(0, limit);
      }, MAX_CANDIDATES);

      if (DEBUG_ITEMS) {
        console.log(`[scan] frame=${frame.url()} items=${frameCandidates.length}`);
      }

      frameCandidates.forEach((item) => {
        candidates.push({
          candidateId: candidates.length,
          frameId: i,
          frameUrl: frame.url(),
          domIndex: item.domIndex,
          text: item.text,
          href: item.href,
          resourceId: item.resourceId,
          dataKey: item.dataKey,
          tag: item.tag,
          id: item.id,
          className: item.className,
          context: item.context,
          reason: item.reason
        });
      });
    } catch {
      if (DEBUG_ITEMS) {
        console.log(`[scan] frame=${frame.url()} error=unavailable`);
      }
    }
  }

  return candidates;
}

function heuristicSelectCandidates(candidates) {
  const keep = candidates.filter((item) => item.resourceId || item.dataKey || item.href);
  const filtered = keep.filter((item) => {
    const text = (item.text || '').trim();
    if (!text) return true;
    return text.length <= 60;
  });
  filtered.sort((a, b) => a.domIndex - b.domIndex);
  return filtered;
}

async function selectCourseItemsWithLLM(page) {
  const candidates = await collectCandidates(page);
  if (DEBUG_LLM) {
    console.log(`[llm] candidates=${candidates.length}`);
  }
  if (!candidates.length) return [];
  if (LLM_DUMP_CANDIDATES) {
    const dumpPath = path.resolve('recordings', 'llm-candidates.json');
    fs.mkdirSync(path.dirname(dumpPath), { recursive: true });
    fs.writeFileSync(dumpPath, JSON.stringify(candidates, null, 2));
    console.log(`Saved LLM candidates to ${dumpPath}`);
  }

  const payload = {
    courseUrl: COURSE_URL,
    instructions: 'Select course content items (lessons/videos) to watch. Ignore navigation, filters, login, or profile links.',
    candidates: candidates.map((item) => ({
      candidateId: item.candidateId,
      frameId: item.frameId,
      frameUrl: item.frameUrl,
      domIndex: item.domIndex,
      text: LLM_MINIMAL_PAYLOAD ? sanitizeText(item.text) : item.text,
      href: LLM_MINIMAL_PAYLOAD ? '' : item.href,
      resourceId: item.resourceId || '',
      dataKey: item.dataKey || '',
      tag: LLM_MINIMAL_PAYLOAD ? '' : item.tag,
      className: LLM_MINIMAL_PAYLOAD ? '' : item.className,
      reason: item.reason
    }))
  };

  const messages = [
    {
      role: 'system',
      content: [
        'You select course content items from candidate DOM elements.',
        'Return ONLY JSON with schema: {"items":[{"candidateId":number}]}',
        'Prefer candidates with reason="outline" or with resourceId/dataKey/href.',
        'Choose items that represent lessons/videos in the course outline.',
        'If unsure, include candidates that have resourceId/dataKey/href.',
        'Preserve the order they appear using domIndex.',
        'Do not include navigation, login, search, or filters.'
      ].join(' ')
    },
    {
      role: 'user',
      content: JSON.stringify(payload)
    }
  ];

  const responseText = await callOpenRouter(messages);
  if (DEBUG_LLM) {
    console.log(`[llm] raw=${responseText.slice(0, 200)}...`);
  }
  const parsed = extractJson(responseText);
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];

  const seen = new Set();
  const selected = [];
  for (const entry of rawItems) {
    const id = typeof entry === 'number' ? entry : entry?.candidateId;
    if (!Number.isInteger(id)) continue;
    const candidate = candidates[id];
    if (!candidate) continue;
    const key = candidate.resourceId || candidate.href || candidate.dataKey || candidate.text || `${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(candidate);
  }

  selected.sort((a, b) => a.domIndex - b.domIndex);
  if (!selected.length && LLM_FALLBACK) {
    const fallback = heuristicSelectCandidates(candidates);
    if (DEBUG_LLM) {
      console.log(`[llm] empty selection, fallback=${fallback.length}`);
    }
    return fallback;
  }
  return selected;
}

function resolveFrame(page, item) {
  const frames = page.frames();
  if (item.frameUrl) {
    const exact = frames.find((frame) => frame.url() === item.frameUrl);
    if (exact) return exact;
  }
  if (Number.isInteger(item.frameId) && frames[item.frameId]) {
    return frames[item.frameId];
  }
  return page.mainFrame();
}

async function clickCourseItem(frame, item) {
  return frame.evaluate((target) => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const click = (el) => {
      if (!el) return false;
      const clickable = el.closest('a,button,[role="button"],[role="link"],div') || el;
      clickable.scrollIntoView({ block: 'center', inline: 'center' });
      clickable.click();
      return true;
    };

    if (target.resourceId) {
      const selector = `a[href*="resourceId=${target.resourceId}"]`;
      const anchor = document.querySelector(selector);
      if (anchor) return click(anchor);
    }

    if (target.href) {
      const anchor = Array.from(document.querySelectorAll('a'))
        .find((el) => (el.href || el.getAttribute('href') || '') === target.href);
      if (anchor) return click(anchor);
      const match = target.href.match(/[?&]resourceId=([^&]+)/);
      const resourceId = match ? match[1] : null;
      const selector = resourceId ? `a[href*="resourceId=${resourceId}"]` : null;
      if (selector) {
        const anchorByResource = document.querySelector(selector);
        if (anchorByResource) return click(anchorByResource);
      }
    }

    if (target.dataKey) {
      const selector = `[data-resource-id="${target.dataKey}"],[data-resourceid="${target.dataKey}"],[data-resid="${target.dataKey}"],[data-resource="${target.dataKey}"]`;
      const node = document.querySelector(selector);
      if (node) return click(node);
    }

    if (target.text) {
      const nodes = Array.from(document.querySelectorAll('a,button,div,span'))
        .filter((el) => normalize(el.textContent || '') === normalize(target.text));
      if (nodes.length) return click(nodes[0]);
    }

    return false;
  }, item);
}

async function waitForCompletion(page) {
  const frame = await getVideoFrame(page);
  const start = Date.now();
  while (Date.now() - start < COMPLETION_TIMEOUT_MS) {
    const status = await frame.evaluate(() => {
      const video = document.querySelector('video');
      const currentTime = video ? Number(video.currentTime || 0) : 0;
      const duration = video ? Number(video.duration || 0) : 0;
      const ratio = duration ? (currentTime / duration) : 0;
      const ended = video ? video.ended : false;
      const scope = video
        ? (video.closest('[class*="player"],[class*="video"],[id*="player"],[id*="video"]') || document)
        : document;
      const markers = Array.from(scope.querySelectorAll('button,div,span,a'))
        .map((el) => (el.textContent || '').trim())
        .filter(Boolean);
      const hasReplay = markers.some((text) => /再学一遍|重新学习|已完成|完成率.*100%|100%/.test(text));
      return { ended, ratio, hasReplay, currentTime, duration };
    });

    if (status.duration) {
      const percent = Math.min(100, Math.round(status.ratio * 1000) / 10);
      console.log(`Progress: ${percent}% (${status.currentTime.toFixed(1)}s/${status.duration.toFixed(1)}s)`);
    } else {
      console.log(`Progress: ${Math.round(status.currentTime)}s`);
    }

    if (status.ended || status.ratio >= 0.995 || status.hasReplay) return status;
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error('Timed out waiting for completion.');
}

async function main() {
  console.log('Runner booting...');
  console.log(`CHROME_PATH=${CHROME_PATH}`);
  console.log(`START_URL=${START_URL}`);
  console.log(`COURSE_URL=${COURSE_URL}`);
  if (!fs.existsSync(CHROME_PATH)) {
    throw new Error(`Chrome not found at ${CHROME_PATH}. Set CHROME_PATH or update the GUI field.`);
  }

  console.log('Launching Chrome...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: HEADLESS,
    userDataDir: USER_DATA_DIR,
    ...(HIDE_AUTOMATION_INFOBAR
      ? {
        ignoreDefaultArgs: ['--enable-automation'],
        args: ['--disable-blink-features=AutomationControlled']
      }
      : {})
  });

  const page = await browser.newPage();
  console.log('Opening start URL...');
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  console.log('Start page loaded.');
  await ensureLogin(page);

  console.log('Opening course URL...');
  await page.goto(COURSE_URL, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  console.log('Course page loaded.');
  await sleep(2000);
  await closeModalIfPresent(page, ['我知道了', '知道了']);
  await sleep(500);

  await clickByText(page, '继续学习');
  await clickByText(page, '开始学习');
  await clickByText(page, '课程目录');
  await clickByText(page, '课程大纲');
  await clickByText(page, '目录');
  await sleep(1500);

  const items = await selectCourseItemsWithLLM(page);
  if (!items.length) throw new Error('No course items found by LLM.');

  console.log(`LLM selected ${items.length} course items.`);

  for (let idx = 0; idx < items.length; idx += 1) {
    const item = items[idx];
    const label = item.text || item.resourceId || item.href || item.dataKey || `item-${idx + 1}`;
    console.log(`[${idx + 1}/${items.length}] Start: ${label}`);
    const frame = resolveFrame(page, item);
    const clicked = await clickCourseItem(frame, item);
    if (!clicked) {
      console.warn(`Failed to click item: ${label}`);
      if (DUMP_ON_ERROR) await dumpPlaybackState(page, item, label, 'click-failed');
      continue;
    }
    await sleep(1500);
    await closeModalIfPresent(page, ['我知道了', '知道了']);

    try {
      const status = await ensureVideoPlaying(page, PLAYBACK_RATE);
      console.log(`Playing at ${status.playbackRate}x, time ${status.currentTime.toFixed(1)}s.`);
      await waitForCompletion(page);
      console.log(`Completed: ${label}`);
    } catch (err) {
      console.error(`Playback failed for ${label}: ${err.message}`);
      if (DUMP_ON_ERROR) await dumpPlaybackState(page, item, label, 'playback-failed');
      throw err;
    }
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
