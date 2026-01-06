import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const RUNNER_PATH = path.join(ROOT_DIR, 'tools', 'simple-runner-manual.js');
const LOG_LIMIT = 5000;
const logBuffer = [];

let mainWindow;
let runnerProcess = null;

function logLine(message) {
  const line = `${new Date().toISOString()} ${message}`;
  logBuffer.push(line);
  if (logBuffer.length > LOG_LIMIT) {
    logBuffer.splice(0, logBuffer.length - LOG_LIMIT);
  }
  console.log(line);
}

function sendLog(message) {
  logLine(message);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', message);
  }
}

function sendStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status', status);
  }
}

function createWindow() {
  logLine('Creating main window...');
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    backgroundColor: '#0f1216',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(ROOT_DIR, 'renderer', 'index.html'));
  mainWindow.webContents.on('did-finish-load', () => {
    logLine('Renderer loaded.');
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, desc) => {
    logLine(`Renderer failed to load: ${code} ${desc}`);
  });
}

async function exportSupportBundle() {
  const defaultName = `support-bundle-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save Support Bundle',
    defaultPath: path.join(app.getPath('downloads'), defaultName),
    filters: [{ name: 'Zip Archive', extensions: ['zip'] }]
  });

  if (canceled || !filePath) return null;

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') reject(err);
    });
    archive.on('error', reject);

    archive.pipe(output);

    const recordingsDir = path.join(ROOT_DIR, 'recordings');

    if (fs.existsSync(recordingsDir)) {
      archive.directory(recordingsDir, 'recordings');
    }
    const logText = logBuffer.join('\n');
    archive.append(logText, { name: 'logs/gui.log' });

    archive.finalize();
  });

  return filePath;
}

function buildRunnerEnv(config) {
  const env = { ...process.env };
  if (config.apiKey) env.OPENROUTER_API_KEY = config.apiKey;
  if (config.model) env.OPENROUTER_MODEL = config.model;
  if (config.proxy) env.HTTPS_PROXY = config.proxy;
  if (config.startUrl) env.START_URL = config.startUrl;
  if (config.chromePath) env.CHROME_PATH = config.chromePath;
  if (config.courseUrl) env.COURSE_URL = config.courseUrl;
  if (config.playbackRate) env.PLAYBACK_RATE = String(config.playbackRate);
  if (config.pollInterval) env.POLL_INTERVAL_MS = String(config.pollInterval);
  if (config.hideAutomation) env.HIDE_AUTOMATION_INFOBAR = '1';
  if (config.headless) env.HEADLESS = '1';
  if (config.dumpCandidates) env.LLM_DUMP_CANDIDATES = '1';
  if (config.dumpOnError === false) env.DUMP_ON_ERROR = '0';
  return env;
}

ipcMain.handle('run-job', async (_event, config) => {
  sendLog('Received run request.');
  if (runnerProcess) {
    sendLog('Runner already active.');
    return { ok: false, reason: 'already_running' };
  }

  if (!fs.existsSync(RUNNER_PATH)) {
    sendLog('Runner script not found.');
    return { ok: false, reason: 'missing_runner' };
  }

  sendStatus({ running: true });
  sendLog('Starting runner...');

  runnerProcess = spawn('node', [RUNNER_PATH], {
    cwd: ROOT_DIR,
    env: buildRunnerEnv(config),
    stdio: ['pipe', 'pipe', 'pipe']
  });

  sendLog(`Runner started (pid ${runnerProcess.pid}).`);

  runnerProcess.stdout.on('data', (chunk) => {
    sendLog(chunk.toString().trimEnd());
  });

  runnerProcess.stderr.on('data', (chunk) => {
    sendLog(chunk.toString().trimEnd());
  });

  runnerProcess.on('close', (code) => {
    sendLog(`Runner exited (code ${code ?? 'unknown'}).`);
    runnerProcess = null;
    sendStatus({ running: false });
  });

  runnerProcess.on('error', (err) => {
    sendLog(`Runner spawn failed: ${err?.message || String(err)}`);
    runnerProcess = null;
    sendStatus({ running: false });
  });

  return { ok: true };
});

ipcMain.handle('stop-job', async () => {
  if (!runnerProcess) return { ok: false, reason: 'not_running' };
  runnerProcess.kill('SIGTERM');
  sendLog('Stopping runner...');
  return { ok: true };
});

ipcMain.handle('continue-login', async () => {
  if (!runnerProcess || !runnerProcess.stdin) return { ok: false, reason: 'not_running' };
  runnerProcess.stdin.write('\n');
  sendLog('Sent continue signal to runner.');
  return { ok: true };
});

ipcMain.handle('export-support-bundle', async () => {
  try {
    const result = await exportSupportBundle();
    if (!result) return { ok: false, canceled: true };
    return { ok: true, path: result };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.on('renderer-event', (_event, message) => {
  logLine(`Renderer event: ${message}`);
});

app.whenReady().then(() => {
  logLine('Electron app ready.');
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
