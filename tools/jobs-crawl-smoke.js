import puppeteer from 'puppeteer-core';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fetch } from 'undici';

const execFileAsync = promisify(execFile);

const START_URL = process.env.START_URL || 'https://jobs.letsgetrusty.com/';
const MAX_PAGES = Number.parseInt(process.env.MAX_PAGES || '0', 10);
const SAMPLE_COUNT = Number.parseInt(process.env.SAMPLE_COUNT || '5', 10);
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const USER_DATA_DIR =
  process.env.CHROME_USER_DATA_DIR || path.join(os.homedir(), '.chrome-jobs-scout');
const CHROME_PROXY = process.env.CHROME_HTTP_PROXY || process.env.CHROME_PROXY || '';
const HEADLESS = process.env.HEADLESS !== '0';
const NO_SANDBOX = process.env.NO_SANDBOX !== '0';
const BROWSER_URL = process.env.BROWSER_URL || '';
const DEBUG_PORT = process.env.DEBUG_PORT || '9222';
const LAUNCH_MODE = process.env.LAUNCH_MODE || 'open';

function logStep(msg) {
  console.log(`[jobs] ${msg}`);
}

function normalizeUrl(href) {
  if (!href) return '';
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('/')) return `https://jobs.letsgetrusty.com${href}`;
  return `https://jobs.letsgetrusty.com/${href}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDebugPort(port) {
  const url = `http://127.0.0.1:${port}/json/version`;
  const startedAt = Date.now();
  const timeoutMs = 20000;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // retry
    }
    await sleep(300);
  }
  throw new Error(`Chrome debug port ${port} not ready`);
}

function normalizeHttpProxy(value) {
  if (!value) return '';
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  return `http://${value}`;
}

async function launchChromeViaOpen(port) {
  const args = [
    '--remote-debugging-port=' + port,
    `--user-data-dir=${USER_DATA_DIR}`,
    '--no-first-run',
    '--no-default-browser-check'
  ];
  if (NO_SANDBOX) args.push('--no-sandbox');
  if (CHROME_PROXY) {
    const proxyValue = normalizeHttpProxy(CHROME_PROXY);
    args.push(`--proxy-server=${proxyValue}`);
  }

  logStep(`launch chrome via open: port=${port}`);
  await execFileAsync('open', ['-na', 'Google Chrome', '--args', ...args]);
  await waitForDebugPort(port);
}

async function closeChromeByPort(port) {
  try {
    const { stdout } = await execFileAsync('lsof', [
      '-iTCP:' + port,
      '-sTCP:LISTEN',
      '-n',
      '-P',
      '-t'
    ]);
    const pid = stdout.trim();
    if (pid) {
      await execFileAsync('kill', [pid]);
      logStep(`closed chrome pid=${pid}`);
    }
  } catch (err) {
    logStep(`failed to close chrome on port ${port}: ${err.message}`);
  }
}

function parsePageCount(html) {
  const regex = /href=["']([^"']*\?page=(\d+)[^"']*)["']/gi;
  let match;
  let max = 1;
  while ((match = regex.exec(html)) !== null) {
    const value = Number.parseInt(match[2], 10);
    if (Number.isFinite(value)) max = Math.max(max, value);
  }
  return max;
}

function extractJobLinksFromHtml(html) {
  const regex = /href=["']([^"']*\?job=[^"']+)["']/gi;
  const items = [];
  const seen = new Set();
  let match;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    if (seen.has(href)) continue;
    seen.add(href);
    items.push({ href, text: '' });
  }
  return items;
}

function extractApplyLink(html) {
  const applyRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>[^<]*(Apply for this position|Apply Now)[^<]*<\/a>/i;
  const match = html.match(applyRegex);
  if (match) return match[1];
  return '';
}

async function main() {
  let browser;
  let startedByScript = false;
  const debugPort = String(DEBUG_PORT).trim() || '9222';

  if (BROWSER_URL) {
    logStep(`connect to existing chrome: ${BROWSER_URL}`);
    browser = await puppeteer.connect({ browserURL: BROWSER_URL });
  } else {
    if (LAUNCH_MODE === 'open') {
      await launchChromeViaOpen(debugPort);
      startedByScript = true;
      browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}` });
    } else {
      const args = [];
      if (NO_SANDBOX) args.push('--no-sandbox');
      if (CHROME_PROXY) {
        const proxyValue = normalizeHttpProxy(CHROME_PROXY);
        args.push(`--proxy-server=${proxyValue}`);
      }

      logStep(`launch chrome headless=${HEADLESS ? 'true' : 'false'}`);
      browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: HEADLESS ? 'new' : false,
        userDataDir: USER_DATA_DIR,
        args
      });
      startedByScript = true;
    }
  }

  const page = await browser.newPage();
  page.setDefaultTimeout(60000);

  logStep(`open ${START_URL}`);
  await page.goto(START_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  const firstHtml = await page.content();
  const totalPages = parsePageCount(firstHtml);
  const pageLimit = MAX_PAGES > 0 ? Math.min(MAX_PAGES, totalPages) : totalPages;
  logStep(`pages=${totalPages}, scan=${pageLimit}`);

  const jobUrls = new Map();
  for (let p = 1; p <= pageLimit; p += 1) {
    const url = p === 1 ? START_URL : `${START_URL.replace(/\/$/, '')}?page=${p}`;
    logStep(`scan page ${p}: ${url}`);
    if (p > 1) {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    }
    const currentUrl = page.url();
    logStep(`page ${p} current url: ${currentUrl}`);
    await sleep(1500);
    let items = await page.evaluate(() => {
      const results = [];

      const scripts = Array.from(document.querySelectorAll('script'));
      for (const script of scripts) {
        const text = script.textContent || '';
        if (!text.includes('"@type":"ItemList"')) continue;
        try {
          const obj = JSON.parse(text);
          const entries = obj.itemListElement || [];
          for (const entry of entries) {
            const item = entry.item || {};
            if (item.url) {
              results.push({ href: item.url, text: item.title || '' });
            }
          }
          if (results.length) return results;
        } catch {
          // fall back to DOM anchors below
        }
      }

      const anchors = Array.from(document.querySelectorAll('a[href*="?job="]'));
      const seen = new Set();
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        if (!href.includes('?job=')) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        results.push({ href, text: (a.textContent || '').trim() });
      }
      return results;
    });
    if (!items.length) {
      const html = await page.content();
      items = extractJobLinksFromHtml(html);
    }
    for (const item of items) {
      const full = normalizeUrl(item.href);
      if (!jobUrls.has(full)) jobUrls.set(full, item.text);
    }
    logStep(`page ${p} found ${items.length} job links`);
  }

  const allJobs = Array.from(jobUrls.entries());
  logStep(`unique jobs=${allJobs.length}`);

  const sample = allJobs.slice(0, SAMPLE_COUNT);
  for (const [jobUrl, title] of sample) {
    logStep(`check job: ${title || 'untitled'} -> ${jobUrl}`);
    await page.goto(jobUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    const html = await page.content();
    const apply = extractApplyLink(html);
    logStep(`apply link: ${apply || 'not found'}`);
  }

  if (BROWSER_URL) {
    await browser.disconnect();
  } else {
    await browser.close();
    if (startedByScript && LAUNCH_MODE === 'open') {
      await closeChromeByPort(debugPort);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
