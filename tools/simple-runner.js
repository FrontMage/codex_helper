import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import puppeteer from 'puppeteer-core';

const COURSE_URL = process.env.COURSE_URL || 'https://basic.smartedu.cn/teacherTraining/courseDetail?courseId=cb134d8b-ebe5-4953-8c2c-10d27b45b8dc&tag=2025%E5%B9%B4%E2%80%9C%E6%9A%91%E6%9C%9F%E6%95%99%E5%B8%88%E7%A0%94%E4%BF%AE%E2%80%9D%E4%B8%93%E9%A2%98&channelId=&libraryId=bb042e69-9a11-49a1-af22-0c3fab2e92b9&breadcrumb=2025%E5%B9%B4%E2%80%9C%E6%9A%91%E6%9C%9F%E6%95%99%E5%B8%88%E7%A0%94%E4%BF%AE%E2%80%9D%E4%B8%93%E9%A2%98&resourceId=d2bdf509-3049-4487-a985-eed857ca003a';
const SESSION_FILE = process.env.SESSION_FILE || path.join(os.homedir(), 'Downloads', 'smartedu-session-basic.json');
const OUTPUT_SESSION = process.env.OUTPUT_SESSION || path.resolve('sessions', 'smartedu-session.json');
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const USER_DATA_DIR = process.env.USER_DATA_DIR || path.join(os.homedir(), '.chrome-smartedu-runner');
const PLAYBACK_RATE = Number(process.env.PLAYBACK_RATE || '2');
const HEADLESS = process.env.HEADLESS === '1';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseCookieString(cookieString) {
  if (!cookieString) return [];
  return cookieString
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf('=');
      if (idx === -1) return null;
      return {
        name: entry.slice(0, idx).trim(),
        value: entry.slice(idx + 1).trim()
      };
    })
    .filter(Boolean);
}

function sanitizeCookie(cookie) {
  const allowed = new Set([
    'name',
    'value',
    'domain',
    'path',
    'expires',
    'httpOnly',
    'secure',
    'sameSite',
    'priority',
    'sameParty',
    'sourceScheme',
    'sourcePort',
    'partitionKey'
  ]);
  const out = {};
  for (const key of Object.keys(cookie)) {
    if (allowed.has(key)) out[key] = cookie[key];
  }
  return out;
}

async function applySession(page, session) {
  const cookieJar = Array.isArray(session.cookieJar) ? session.cookieJar.map(sanitizeCookie) : null;
  const cookieString = session.cookies || '';
  const fromString = parseCookieString(cookieString).map((cookie) => ({
    ...cookie,
    domain: '.smartedu.cn',
    path: '/'
  }));
  const cookies = cookieJar && cookieJar.length ? cookieJar : fromString;
  if (cookies.length) {
    try {
      await page.setCookie(...cookies);
    } catch (err) {
      console.warn('Cookie apply failed:', err.message);
    }
  }

  await page.evaluate((payload) => {
    const applyStorage = (storage, entries) => {
      if (!entries || typeof entries !== 'object') return;
      Object.entries(entries).forEach(([key, value]) => {
        storage.setItem(key, value);
      });
    };

    try {
      applyStorage(localStorage, payload.localStorage);
      applyStorage(sessionStorage, payload.sessionStorage);
    } catch {
      // Ignore storage errors on locked contexts.
    }
  }, {
    localStorage: session.localStorage || {},
    sessionStorage: session.sessionStorage || {}
  });
}

async function collectSession(page) {
  const cookieJar = await page.cookies('https://basic.smartedu.cn', 'https://auth.smartedu.cn');
  const storages = await page.evaluate(() => {
    const collect = (storage) => {
      const out = {};
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        out[key] = storage.getItem(key);
      }
      return out;
    };
    return {
      cookies: document.cookie,
      localStorage: collect(localStorage),
      sessionStorage: collect(sessionStorage)
    };
  });
  return {
    cookies: storages.cookies,
    cookieJar,
    localStorage: storages.localStorage,
    sessionStorage: storages.sessionStorage
  };
}

async function isLoggedIn(page) {
  const cookies = await page.cookies('https://basic.smartedu.cn');
  const hasToken = cookies.some((cookie) => /UC_TOKEN|X-EDU-WEB-ROLE/i.test(cookie.name));
  const uiFlags = await page.evaluate(() => {
    const loginTexts = new Set(['登录', '注册']);
    const hasLogin = Array.from(document.querySelectorAll('a,button,span,div'))
      .some((el) => loginTexts.has((el.textContent || '').trim()));
    const hasUserLink = !!document.querySelector('a[href*="/user/"]');
    return { hasLogin, hasUserLink };
  });
  return hasToken || (uiFlags.hasUserLink && !uiFlags.hasLogin);
}

async function waitForUserLogin(page) {
  console.log('Please complete login in the browser window. Press Enter here when done.');
  await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', () => {
      rl.close();
      resolve();
    });
  });

  await page.goto('https://basic.smartedu.cn/', { waitUntil: 'domcontentloaded' });
  const ok = await isLoggedIn(page);
  if (!ok) throw new Error('Login not detected.');
}

async function closeModalIfPresent(page, texts) {
  await page.evaluate((targets) => {
    const elements = Array.from(document.querySelectorAll('button,div,span,a'));
    const match = elements.find((el) => targets.includes((el.textContent || '').trim()));
    if (match) match.click();
  }, texts);
}

async function ensureVideoPlaying(page, rate) {
  await page.waitForSelector('video', { timeout: 30000 });
  await page.evaluate((playbackRate) => {
    const video = document.querySelector('video');
    if (!video) return;
    video.muted = true;
    video.volume = 0;
    video.playbackRate = playbackRate;
  }, rate);

  const started = await page.evaluate(async () => {
    const video = document.querySelector('video');
    if (!video) return { ok: false, reason: 'no_video' };
    try {
      await video.play();
    } catch {
      return { ok: false, reason: 'play_failed' };
    }
    return { ok: true };
  });

  if (!started.ok) throw new Error(`Playback failed: ${started.reason}`);

  await sleep(3000);
  const status = await page.evaluate(() => {
    const video = document.querySelector('video');
    if (!video) return { ok: false };
    return {
      ok: true,
      paused: video.paused,
      currentTime: Number(video.currentTime || 0),
      duration: Number(video.duration || 0),
      playbackRate: video.playbackRate
    };
  });

  if (!status.ok || status.currentTime <= 0 || status.paused) {
    throw new Error('Video did not start playing.');
  }

  return status;
}

async function clickResourceByText(page, text) {
  return page.evaluate((targetText) => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const node = Array.from(document.querySelectorAll('*'))
      .find((el) => normalize(el.innerText || el.textContent).includes(targetText));
    if (!node) return false;
    const clickable = node.closest('a,button,[role="button"],[role="link"],div') || node;
    clickable.scrollIntoView({ block: 'center', inline: 'center' });
    clickable.click();
    return true;
  }, text);
}

async function clickByText(page, text) {
  return page.evaluate((targetText) => {
    const node = Array.from(document.querySelectorAll('a,button,div,span'))
      .find((el) => (el.innerText || '').trim() === targetText);
    if (!node) return false;
    const clickable = node.closest('a,button,[role=\"button\"],[role=\"link\"],div') || node;
    clickable.scrollIntoView({ block: 'center', inline: 'center' });
    clickable.click();
    return true;
  }, text);
}

async function navigateToResource(page, title) {
  await page.waitForFunction(() => document.querySelector('.resource-item') || document.body.innerText.includes('课程大纲'), { timeout: 15000 }).catch(() => {});
  const byContinue = await clickByText(page, '继续学习');
  if (byContinue) return 'continue';
  const byStart = await clickByText(page, '开始学习');
  if (byStart) return 'start';
  const byTitle = await clickResourceByText(page, title);
  if (byTitle) return 'title';
  const byFirst = await page.evaluate(() => {
    const item = document.querySelector('.resource-item');
    if (!item) return false;
    const clickable = item.closest('a,button,[role=\"button\"],[role=\"link\"],div') || item;
    clickable.scrollIntoView({ block: 'center', inline: 'center' });
    clickable.click();
    return true;
  });
  return byFirst ? 'first' : false;
}

async function main() {
  fs.mkdirSync(path.dirname(OUTPUT_SESSION), { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: HEADLESS,
    userDataDir: USER_DATA_DIR,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-crashpad',
      '--disable-crash-reporter'
    ]
  });

  const page = await browser.newPage();
  await page.goto('https://basic.smartedu.cn/', { waitUntil: 'domcontentloaded' });

  if (fs.existsSync(SESSION_FILE)) {
    const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    await applySession(page, session);
    await page.reload({ waitUntil: 'domcontentloaded' });
  }

  if (!(await isLoggedIn(page))) {
    await page.goto('https://auth.smartedu.cn/uias/login', { waitUntil: 'domcontentloaded' });
    await waitForUserLogin(page);
  }

  const freshSession = await collectSession(page);
  fs.writeFileSync(OUTPUT_SESSION, JSON.stringify(freshSession, null, 2));

  await page.goto(COURSE_URL, { waitUntil: 'domcontentloaded' });
  await sleep(2000);
  await closeModalIfPresent(page, ['我知道了', '知道了']);
  await sleep(500);

  if (!await page.$('video')) {
    const currentUrl = page.url();
    if (!currentUrl.includes('courseDetail')) {
      console.warn(`Not on courseDetail yet: ${currentUrl}`);
    }
    const markers = await page.evaluate(() => ({
      hasStart: document.body.innerText.includes('开始学习'),
      hasContinue: document.body.innerText.includes('继续学习'),
      resourceItems: document.querySelectorAll('.resource-item').length
    }));
    console.log(`Page markers: ${JSON.stringify(markers)}`);
    const clicked = await navigateToResource(page, '于平：地质宫不灭的灯火');
    if (!clicked) {
      console.warn('Resource item not found on the page.');
    } else {
      console.log(`Navigation attempt: ${clicked}`);
    }
    await sleep(2000);
    await closeModalIfPresent(page, ['我知道了', '知道了']);
    try {
      await page.waitForFunction(() => location.href.includes('courseDetail') || document.querySelector('video'), { timeout: 30000 });
      await page.waitForSelector('video', { timeout: 30000 });
    } catch (err) {
      console.error(`Video not found after navigation: ${page.url()}`);
      throw err;
    }
  }

  try {
    const status = await ensureVideoPlaying(page, PLAYBACK_RATE);
    console.log(`Playback started at rate ${status.playbackRate}x, time ${status.currentTime.toFixed(1)}s.`);
    console.log(`Session saved to ${OUTPUT_SESSION}`);
  } catch (err) {
    console.error(`Playback check failed: ${err.message}`);
    console.error(`Current URL: ${page.url()}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
