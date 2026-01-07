import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { runCrawl } from '../runner/crawl.js';
import { loadJobs, loadResume, recommendJobs } from '../runner/recommend.js';

const ROOT_DIR = path.resolve(__dirname, '..');
const rendererPath = path.join(ROOT_DIR, 'renderer', 'index.html');
const logBuffer = [];
const MAX_LOG_LINES = 5000;
let currentAbort = null;

function pushLog(line) {
  const text = `[${new Date().toISOString()}] ${line}`;
  logBuffer.push(text);
  if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send('log-line', text);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  win.loadFile(rendererPath);
  win.on('closed', () => {
    app.quit();
  });
}

app.whenReady().then(() => {
  createWindow();
  pushLog('UI ready.');
});

ipcMain.on('start-run', (_event, config) => {
  if (currentAbort) {
    pushLog('Runner already active.');
    return;
  }
  pushLog(`Start requested: ${JSON.stringify(config)}`);
  const controller = new AbortController();
  currentAbort = controller;

  runCrawl(
    {
      startUrl: 'https://jobs.letsgetrusty.com/',
      apiKey: config.apiKey,
      model: config.model || 'openai/gpt-5.1-codex',
      httpProxy: config.chromeProxy,
      llmProxy: config.llmProxy,
      chromePath: config.chromePath,
      maxPages: config.maxPages,
      maxJobs: config.maxJobs,
      headless: config.headless === '1'
    },
    (line) => pushLog(line),
    { signal: controller.signal }
  )
    .then((outputPath) => {
      pushLog(`Crawl done: ${outputPath}`);
    })
    .catch((err) => {
      pushLog(`Crawl failed: ${err.message}`);
    })
    .finally(() => {
      currentAbort = null;
    });
});

ipcMain.on('stop-run', () => {
  if (currentAbort) {
    currentAbort.abort();
    pushLog('Stop requested.');
  }
});

ipcMain.handle('pick-resume', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (result.canceled || !result.filePaths.length) return { ok: false };
  const filePath = result.filePaths[0];
  return { ok: true, filePath };
});

ipcMain.handle('save-resume', async (_event, { filePath, content }) => {
  try {
    fs.mkdirSync(path.join(ROOT_DIR, 'data'), { recursive: true });
    const target = path.join(ROOT_DIR, 'data', 'resume.md');
    if (filePath) {
      fs.copyFileSync(filePath, target);
    } else if (content) {
      fs.writeFileSync(target, content);
    }
    return { ok: true, target };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('export-logs', async () => {
  const result = await dialog.showSaveDialog({
    defaultPath: 'jobs-scout-logs.txt'
  });
  if (result.canceled || !result.filePath) return { ok: false };
  fs.writeFileSync(result.filePath, logBuffer.join('\n'));
  return { ok: true, filePath: result.filePath };
});

ipcMain.handle('chat-send', async (_event, payload) => {
  try {
    const dataDir = path.join(ROOT_DIR, 'data');
    const jobs = loadJobs(dataDir);
    const resume = payload.resumeText?.trim() ? payload.resumeText : loadResume(dataDir);

    pushLog(`Chat request: ${payload.message?.slice(0, 120) || ''}`);

    const result = await recommendJobs({
      apiKey: payload.apiKey,
      model: payload.model || 'openai/gpt-5.1-codex',
      llmProxy: payload.llmProxy,
      resumeText: resume,
      userMessage: payload.message,
      jobs,
      limit: Number.parseInt(payload.limit || '80', 10),
      onlyOpen: payload.onlyOpen !== false
    });

    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
