import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { callOpenRouter, extractJson } from './llm.js';

function logLine(log, message) {
  if (log) log(message);
  else console.log(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function gotoWithRetry(page, url, { waitUntil, timeoutMs, retries, log }) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await page.goto(url, { waitUntil, timeout: timeoutMs });
      return true;
    } catch (err) {
      logLine(log, `Navigation failed (${attempt}/${retries}) ${url}: ${err.message}`);
      if (attempt === retries) return false;
      await sleep(1000 * attempt);
    }
  }
  return false;
}

function normalizeUrl(href) {
  if (!href) return '';
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('/')) return `https://jobs.letsgetrusty.com${href}`;
  return `https://jobs.letsgetrusty.com/${href}`;
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

function extractApplyLink(html) {
  const applyRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>[^<]*(Apply for this position|Apply Now)[^<]*<\/a>/i;
  const match = html.match(applyRegex);
  if (match) return match[1];
  return '';
}

function normalizeHttpProxy(value) {
  if (!value) return '';
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  return `http://${value}`;
}

async function launchChrome({
  chromePath,
  userDataDir,
  httpProxy,
  noSandbox,
  headless
}) {
  const args = [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--disable-features=Crashpad'
  ];
  if (noSandbox) args.push('--no-sandbox');
  if (httpProxy) {
    const proxyValue = normalizeHttpProxy(httpProxy);
    args.push(`--proxy-server=${proxyValue}`);
  }
  if (headless) args.push('--headless=new');

  return puppeteer.launch({
    executablePath: chromePath,
    headless: headless ? 'new' : false,
    userDataDir,
    args
  });
}

function trimHtml(html, maxLen = 120000) {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\s+/g, ' ');
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen);
}

async function extractJobsFromPage(page) {
  return page.evaluate(() => {
    const results = [];

    const scripts = Array.from(document.querySelectorAll('script'));
    const itemListRegex = /"@type"\s*:\s*"ItemList"/;
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!itemListRegex.test(text)) continue;
      try {
        const obj = JSON.parse(text);
        const entries = obj.itemListElement || [];
        for (const entry of entries) {
          const item = entry.item || {};
          if (item.url) {
            results.push({
              href: item.url,
              title: item.title || '',
              company: item.hiringOrganization?.name || ''
            });
          }
        }
        if (results.length) return results;
      } catch {
        // ignore
      }
    }

    const anchors = Array.from(document.querySelectorAll('a[href*="?job="]'));
    const seen = new Set();
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      if (!href.includes('?job=')) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      results.push({
        href,
        title: (a.textContent || '').trim().replace(/\s+/g, ' '),
        company: ''
      });
    }
    return results;
  });
}

async function waitForJobMarkers(page, timeoutMs, log) {
  try {
    await page.waitForFunction(
      () => {
        const hasAnchors = Boolean(document.querySelector('a[href*="?job="]'));
        if (hasAnchors) return true;
        const scripts = Array.from(document.querySelectorAll('script'));
        const itemListRegex = /"@type"\s*:\s*"ItemList"/;
        return scripts.some((s) => itemListRegex.test(s.textContent || ''));
      },
      { timeout: timeoutMs }
    );
  } catch (err) {
    logLine(log, `job markers not found: ${err.message}`);
  }
}

async function logEmptyPageDebug(page, log) {
  try {
    const info = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      text: (document.body?.innerText || '').slice(0, 240)
    }));
    const cleanText = info.text.replace(/\s+/g, ' ').trim();
    logLine(log, `empty page debug: title="${info.title}" url="${info.url}" text="${cleanText}"`);
  } catch (err) {
    logLine(log, `empty page debug failed: ${err.message}`);
  }
}

async function extractApplyFromJobPage(page) {
  return page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a'));
    const match = anchors.find((a) => {
      const text = (a.textContent || '').trim();
      return text.includes('Apply for this position') || text.includes('Apply Now');
    });
    return match ? match.href : '';
  });
}

async function callExtractLLM({ apiKey, model, llmProxy, jobUrl, applyUrl, html }) {
  const prompt = {
    role: 'user',
    content: JSON.stringify({
      jobUrl,
      applyUrl,
      html
    })
  };
  const messages = [
    {
      role: 'system',
      content:
        'You extract job data from HTML. Return ONLY JSON with schema: {"title":"","company":"","location":"","summary":"","responsibilities":[],"requirements":[],"benefits":[],"isClosed":false,"closedReason":""}. If the job is closed or not accepting applications, set isClosed=true and explain in closedReason.'
    },
    prompt
  ];
  const raw = await callOpenRouter({ apiKey, model, messages, proxy: llmProxy });
  const parsed = extractJson(raw);
  if (!parsed) {
    throw new Error('LLM returned invalid JSON');
  }
  return parsed;
}

export async function runCrawl(config, log, { signal } = {}) {
  const dataDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const outputPath = path.join(dataDir, 'jobs.jsonl');
  const maxPages = Number.parseInt(config.maxPages || '0', 10);
  const maxJobs = Number.parseInt(config.maxJobs || '0', 10);
  const navTimeoutMs = Number.parseInt(config.navTimeoutMs || '90000', 10);
  const maxNavRetries = Number.parseInt(config.maxNavRetries || '2', 10);

  let browser;
  const userDataDir = config.userDataDir || path.join(dataDir, 'chrome-profile');

  try {
    if (config.browserUrl) {
      logLine(log, `connect to existing chrome: ${config.browserUrl}`);
      browser = await puppeteer.connect({ browserURL: config.browserUrl });
    } else {
      const shouldHeadless =
        config.headless === true || config.headless === '1' || config.headless === 1;
      browser = await launchChrome({
        chromePath: config.chromePath || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        userDataDir,
        httpProxy: config.httpProxy || '',
        noSandbox: config.noSandbox !== false,
        headless: shouldHeadless
      });
      logLine(
        log,
        `launched chrome (${shouldHeadless ? 'headless' : 'headful'}) via puppeteer.`
      );
    }

    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(navTimeoutMs);

    logLine(log, `open ${config.startUrl}`);
    const startOk = await gotoWithRetry(page, config.startUrl, {
      waitUntil: 'domcontentloaded',
      timeoutMs: navTimeoutMs,
      retries: maxNavRetries,
      log
    });
    if (!startOk) throw new Error('Failed to load start URL.');
    const firstHtml = await page.content();
    const totalPages = parsePageCount(firstHtml);
    const pageLimit = maxPages > 0 ? Math.min(maxPages, totalPages) : totalPages;
    logLine(log, `pages=${totalPages}, scan=${pageLimit}`);

    const jobUrls = new Map();
    for (let p = 1; p <= pageLimit; p += 1) {
      if (signal?.aborted) throw new Error('Cancelled');
      const url = p === 1 ? config.startUrl : `${config.startUrl.replace(/\/$/, '')}?page=${p}`;
      logLine(log, `scan page ${p}: ${url}`);
      if (p > 1) {
        const ok = await gotoWithRetry(page, url, {
          waitUntil: 'domcontentloaded',
          timeoutMs: navTimeoutMs,
          retries: maxNavRetries,
          log
        });
        if (!ok) {
          logLine(log, `skip page ${p} due to navigation failure.`);
          continue;
        }
      }
      await waitForJobMarkers(page, 12000, log);
      await sleep(800);
      const items = await extractJobsFromPage(page);
      if (!items.length) {
        await logEmptyPageDebug(page, log);
      }
      for (const item of items) {
        const full = normalizeUrl(item.href);
        if (!jobUrls.has(full)) jobUrls.set(full, item);
      }
      logLine(log, `page ${p} found ${items.length} job links`);
    }

    const allJobs = Array.from(jobUrls.entries());
    logLine(log, `unique jobs=${allJobs.length}`);

    let processed = 0;
    for (const [jobUrl, item] of allJobs) {
      if (signal?.aborted) throw new Error('Cancelled');
      if (maxJobs > 0 && processed >= maxJobs) break;
      processed += 1;

      logLine(log, `[${processed}/${maxJobs || allJobs.length}] job: ${item.title || 'untitled'}`);
      const jobOk = await gotoWithRetry(page, jobUrl, {
        waitUntil: 'domcontentloaded',
        timeoutMs: navTimeoutMs,
        retries: maxNavRetries,
        log
      });
      if (!jobOk) {
        logLine(log, `skip job due to navigation failure: ${jobUrl}`);
        continue;
      }
      const jobHtml = await page.content();
      const applyUrl = await extractApplyFromJobPage(page) || extractApplyLink(jobHtml);

      if (!applyUrl) {
        const record = {
          jobUrl,
          title: item.title || '',
          company: item.company || '',
          applyUrl: '',
          isClosed: null,
          reason: 'apply link not found'
        };
        fs.appendFileSync(outputPath, JSON.stringify(record) + '\n');
        logLine(log, `apply link missing: ${jobUrl}`);
        continue;
      }

      const applyPage = await browser.newPage();
      try {
        const applyOk = await gotoWithRetry(applyPage, applyUrl, {
          waitUntil: 'domcontentloaded',
          timeoutMs: navTimeoutMs,
          retries: maxNavRetries,
          log
        });
        if (!applyOk) {
          const record = {
            jobUrl,
            title: item.title || '',
            company: item.company || '',
            applyUrl,
            isClosed: null,
            reason: 'apply page navigation failed'
          };
          fs.appendFileSync(outputPath, JSON.stringify(record) + '\n');
          logLine(log, `apply page failed: ${applyUrl}`);
          continue;
        }
        const applyHtml = await applyPage.content();
        const trimmed = trimHtml(applyHtml);

        let extracted = null;
        try {
          extracted = await callExtractLLM({
            apiKey: config.apiKey,
            model: config.model,
            llmProxy: config.llmProxy || '',
            jobUrl,
            applyUrl,
            html: trimmed
          });
        } catch (err) {
          logLine(log, `LLM extract failed: ${err.message}`);
        }

        const record = {
          jobUrl,
          title: extracted?.title || item.title || '',
          company: extracted?.company || item.company || '',
          applyUrl,
          location: extracted?.location || '',
          summary: extracted?.summary || '',
          responsibilities: extracted?.responsibilities || [],
          requirements: extracted?.requirements || [],
          benefits: extracted?.benefits || [],
          isClosed: extracted?.isClosed ?? null,
          closedReason: extracted?.closedReason || ''
        };
        fs.appendFileSync(outputPath, JSON.stringify(record) + '\n');
        logLine(log, `saved: ${record.title || 'untitled'}`);
      } finally {
        await applyPage.close();
      }
    }

    return outputPath;
  } finally {
    if (browser) {
      if (config.browserUrl) {
        await browser.disconnect();
      } else {
        await browser.close();
      }
    }
  }
}
