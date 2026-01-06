import fs from "fs";
import path from "path";
import puppeteer from "puppeteer-core";

const cdpUrl = process.env.CDP_URL || "http://127.0.0.1:9222";
const hostFilter = process.env.HOST_FILTER || "smartedu.cn";
const recordDir = process.env.RECORD_DIR || path.resolve("recordings");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputFile = path.join(recordDir, `recording-${stamp}.jsonl`);

fs.mkdirSync(recordDir, { recursive: true });
const stream = fs.createWriteStream(outputFile, { flags: "a" });

function shouldRecordUrl(url) {
  if (!url || url === "about:blank") return false;
  if (!hostFilter) return true;
  try {
    const host = new URL(url).hostname;
    return host === hostFilter || host.endsWith(`.${hostFilter}`);
  } catch {
    return false;
  }
}

function writeEvent(event) {
  stream.write(`${JSON.stringify(event)}\n`);
}

const injectedScript = `(() => {
  if (window.__cdxInstalled) return;
  window.__cdxInstalled = true;

  const cssEscape = (value) => {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$");
  };

  const truncate = (value, max = 160) => {
    if (!value) return "";
    const str = String(value).replace(/\s+/g, " ").trim();
    return str.length > max ? str.slice(0, max) : str;
  };

  const buildSelector = (el) => {
    if (!el || el.nodeType !== 1) return "";
    const id = el.getAttribute("id");
    if (id) {
      const escaped = cssEscape(id);
      const matches = document.querySelectorAll(`#${escaped}`).length;
      if (matches === 1) return `#${escaped}`;
    }

    const testId = el.getAttribute("data-testid") || el.getAttribute("data-test") || el.getAttribute("data-qa");
    if (testId) return `[data-testid=\"${cssEscape(testId)}\"]`;

    const parts = [];
    let current = el;
    while (current && current.nodeType === 1 && current !== document.body) {
      const tag = current.tagName.toLowerCase();
      const siblings = Array.from(current.parentNode.children).filter((node) => node.tagName === current.tagName);
      const index = siblings.indexOf(current) + 1;
      parts.unshift(`${tag}:nth-of-type(${index})`);
      current = current.parentNode;
    }
    return parts.length ? parts.join(" > ") : "";
  };

  const elementInfo = (el) => {
    if (!el || el.nodeType !== 1) return { selector: "" };
    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role") || "";
    const ariaLabel = el.getAttribute("aria-label") || "";
    const text = truncate(el.innerText || el.textContent || "");
    const type = el.getAttribute("type") || "";
    let value = "";
    if (tag === "input" || tag === "textarea" || tag === "select") {
      if (type === "password") {
        value = "__PASSWORD__";
      } else if (tag === "select") {
        const selected = Array.from(el.selectedOptions || []).map((opt) => opt.value || opt.textContent || "").join(",");
        value = truncate(selected);
      } else {
        value = truncate(el.value || "");
      }
    }

    return {
      selector: buildSelector(el),
      tag,
      role,
      ariaLabel,
      text,
      type,
      value,
      checked: !!el.checked,
      disabled: !!el.disabled,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  };

  const send = (payload) => {
    if (typeof window.__cdxRecord !== "function") return;
    try {
      window.__cdxRecord(payload);
    } catch {
      // ignore
    }
  };

  const record = (type, el, extra = {}) => {
    const info = elementInfo(el);
    send({
      type,
      url: location.href,
      time: Date.now(),
      ...info,
      ...extra
    });
  };

  document.addEventListener("click", (event) => record("click", event.target), true);
  document.addEventListener("change", (event) => record("change", event.target), true);
  document.addEventListener("input", (event) => record("input", event.target), true);

  const markMap = {
    Digit1: "mark_play_start",
    Digit2: "mark_play_end",
    Digit3: "mark_back_list"
  };

  document.addEventListener("keydown", (event) => {
    if (!event.ctrlKey || !event.shiftKey) return;
    const mark = markMap[event.code];
    if (!mark) return;
    send({
      type: mark,
      url: location.href,
      time: Date.now(),
      note: "manual_mark"
    });
  }, true);

  const seenVideos = new WeakSet();
  const hookVideo = (video) => {
    if (seenVideos.has(video)) return;
    seenVideos.add(video);
    const info = () => ({
      currentTime: Number(video.currentTime || 0),
      duration: Number(video.duration || 0),
      paused: !!video.paused,
      ended: !!video.ended
    });
    video.addEventListener("play", () => send({ type: "video_play", url: location.href, time: Date.now(), ...info() }));
    video.addEventListener("pause", () => send({ type: "video_pause", url: location.href, time: Date.now(), ...info() }));
    video.addEventListener("ended", () => send({ type: "video_ended", url: location.href, time: Date.now(), ...info() }));
  };

  const scanVideos = () => {
    document.querySelectorAll("video").forEach((video) => hookVideo(video));
  };

  scanVideos();
  setInterval(scanVideos, 1000);
})();`;

const instrumented = new WeakSet();

async function instrumentPage(page) {
  if (instrumented.has(page)) return;
  instrumented.add(page);

  try {
    await page.exposeBinding("__cdxRecord", (_source, payload) => {
      if (!shouldRecordUrl(payload.url)) return;
      writeEvent({ source: "page", ...payload });
    });
  } catch {
    // ignore if already bound
  }

  try {
    await page.evaluateOnNewDocument(injectedScript);
    await page.evaluate(injectedScript);
  } catch {
    // ignore if page is closed
  }

  page.on("framenavigated", (frame) => {
    if (!shouldRecordUrl(frame.url())) return;
    writeEvent({
      source: "page",
      type: "navigate",
      url: frame.url(),
      time: Date.now()
    });
  });
}

const browser = await puppeteer.connect({ browserURL: cdpUrl });
console.log(`Connected to Chrome at ${cdpUrl}`);
console.log(`Recording host filter: ${hostFilter}`);
console.log(`Output: ${outputFile}`);
console.log("Manual marks: Ctrl+Shift+1 = play start, Ctrl+Shift+2 = play end, Ctrl+Shift+3 = back to list");

const pages = await browser.pages();
await Promise.all(pages.map((page) => instrumentPage(page)));

browser.on("targetcreated", async (target) => {
  if (target.type() !== "page") return;
  const page = await target.page();
  if (page) await instrumentPage(page);
});

process.on("SIGINT", async () => {
  console.log("\nStopping recorder...");
  stream.end();
  await browser.disconnect();
  process.exit(0);
});
