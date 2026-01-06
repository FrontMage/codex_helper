const logOutput = document.getElementById('logOutput');
const statusBadge = document.getElementById('statusBadge');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const continueBtn = document.getElementById('continueBtn');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearLogs');
const toggleKey = document.getElementById('toggleKey');
const apiKeyInput = document.getElementById('apiKey');

function appendLog(message) {
  if (!message) return;
  const line = document.createElement('div');
  line.textContent = message;
  logOutput.appendChild(line);
  logOutput.scrollTop = logOutput.scrollHeight;
}

function setStatus(running) {
  statusBadge.textContent = running ? '运行中' : '空闲';
  statusBadge.style.color = running ? '#f6b73c' : '#9aa6b2';
  stopBtn.disabled = !running;
  startBtn.disabled = running;
  continueBtn.disabled = !running;
}

function getConfig() {
  return {
    apiKey: apiKeyInput.value.trim(),
    model: document.getElementById('model').value.trim(),
    proxy: document.getElementById('proxy').value.trim(),
    startUrl: document.getElementById('startUrl').value.trim(),
    chromePath: document.getElementById('chromePath').value.trim(),
    courseUrl: document.getElementById('courseUrl').value.trim(),
    playbackRate: Number(document.getElementById('playbackRate').value || 2),
    pollInterval: Number(document.getElementById('pollInterval').value || 10000),
    hideAutomation: document.getElementById('hideAutomation').checked,
    headless: document.getElementById('headless').checked,
    dumpCandidates: document.getElementById('dumpCandidates').checked,
    dumpOnError: document.getElementById('dumpOnError').checked
  };
}

if (window.api) {
  window.api.onLog(appendLog);
  window.api.onStatus((status) => setStatus(Boolean(status?.running)));
  window.api.notify('renderer-loaded');
} else {
  appendLog('IPC bridge 不可用，预加载失败。');
  startBtn.disabled = true;
}

document.addEventListener('click', (event) => {
  const target = event.target;
  const label = target?.id ? `#${target.id}` : target?.tagName || 'unknown';
  if (window.api?.notify) window.api.notify(`click:${label}`);
  if (label === '#startBtn') {
    appendLog('UI click captured: Start button.');
  }
});

startBtn.addEventListener('click', async () => {
  const config = getConfig();
  if (window.api?.notify) window.api.notify('start-clicked');
  appendLog('正在启动运行器...');
  if (!window.api) return;
  const result = await window.api.run(config);
  if (!result.ok) {
    appendLog(`启动失败：${result.reason || result.error || 'unknown'}`);
  }
});

stopBtn.addEventListener('click', async () => {
  if (!window.api) return;
  const result = await window.api.stop();
  if (!result.ok) {
    appendLog(`停止失败：${result.reason || result.error || 'unknown'}`);
  }
});

continueBtn.addEventListener('click', async () => {
  if (!window.api) return;
  const result = await window.api.continueLogin();
  if (!result.ok) {
    appendLog(`继续失败：${result.reason || result.error || 'unknown'}`);
  }
});

exportBtn.addEventListener('click', async () => {
  if (!window.api) return;
  appendLog('正在生成支持包...');
  const result = await window.api.exportBundle();
  if (result.ok) {
    appendLog(`支持包已保存：${result.path}`);
  } else if (!result.canceled) {
    appendLog(`支持包生成失败：${result.error || 'unknown'}`);
  }
});

clearBtn.addEventListener('click', () => {
  logOutput.innerHTML = '';
});

toggleKey.addEventListener('click', () => {
  const isPassword = apiKeyInput.getAttribute('type') === 'password';
  apiKeyInput.setAttribute('type', isPassword ? 'text' : 'password');
  toggleKey.textContent = isPassword ? '隐藏' : '显示';
});

setStatus(false);
appendLog('界面已就绪。');
