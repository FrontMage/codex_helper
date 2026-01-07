import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

const ROOT_DIR = path.resolve(__dirname, '..');
const rendererPath = path.join(ROOT_DIR, 'renderer', 'index.html');
const logBuffer = [];
const MAX_LOG_LINES = 5000;

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
  pushLog(`Start requested: ${JSON.stringify(config)}`);
  pushLog('TODO: runner not wired yet.');
});

ipcMain.on('stop-run', () => {
  pushLog('Stop requested.');
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
