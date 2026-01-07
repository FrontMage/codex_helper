const logBox = document.getElementById('logBox');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const exportBtn = document.getElementById('exportBtn');
const pickResumeBtn = document.getElementById('pickResumeBtn');
const saveResumeBtn = document.getElementById('saveResumeBtn');
const resumeText = document.getElementById('resumeText');
const resumeStatus = document.getElementById('resumeStatus');
const chatHistory = document.getElementById('chatHistory');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');

const fields = {
  apiKey: document.getElementById('apiKey'),
  model: document.getElementById('model'),
  proxy: document.getElementById('proxy'),
  chromePath: document.getElementById('chromePath'),
  maxPages: document.getElementById('maxPages'),
  headless: document.getElementById('headless')
};

function appendLog(line) {
  const entry = document.createElement('div');
  entry.textContent = line;
  logBox.appendChild(entry);
  logBox.scrollTop = logBox.scrollHeight;
}

function appendChat(role, text) {
  const entry = document.createElement('div');
  entry.classList.add('entry', role);
  entry.textContent = `${role === 'user' ? '你' : '助手'}：${text}`;
  chatHistory.appendChild(entry);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

window.jobsApi.onLog((line) => appendLog(line));

startBtn.addEventListener('click', () => {
  window.jobsApi.startRun({
    apiKey: fields.apiKey.value,
    model: fields.model.value,
    proxy: fields.proxy.value,
    chromePath: fields.chromePath.value,
    maxPages: fields.maxPages.value,
    headless: fields.headless.value
  });
});

stopBtn.addEventListener('click', () => {
  window.jobsApi.stopRun();
});

exportBtn.addEventListener('click', async () => {
  const res = await window.jobsApi.exportLogs();
  if (res.ok) {
    appendLog(`日志已保存: ${res.filePath}`);
  }
});

pickResumeBtn.addEventListener('click', async () => {
  const res = await window.jobsApi.pickResume();
  if (res.ok) {
    resumeStatus.textContent = `已选择: ${res.filePath}`;
    const save = await window.jobsApi.saveResume({ filePath: res.filePath });
    if (save.ok) {
      resumeStatus.textContent = `已保存到: ${save.target}`;
    }
  }
});

saveResumeBtn.addEventListener('click', async () => {
  const content = resumeText.value.trim();
  if (!content) {
    resumeStatus.textContent = '请先输入或选择简历。';
    return;
  }
  const save = await window.jobsApi.saveResume({ content });
  if (save.ok) {
    resumeStatus.textContent = `已保存到: ${save.target}`;
  } else {
    resumeStatus.textContent = `保存失败: ${save.error}`;
  }
});

chatSendBtn.addEventListener('click', () => {
  const text = chatInput.value.trim();
  if (!text) return;
  appendChat('user', text);
  chatInput.value = '';
  appendChat('assistant', '（待接入 LLM 推荐引擎）');
});
