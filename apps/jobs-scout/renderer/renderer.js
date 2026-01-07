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
const onlyOpenToggle = document.getElementById('onlyOpen');

const fields = {
  apiKey: document.getElementById('apiKey'),
  model: document.getElementById('model'),
  chromeProxy: document.getElementById('chromeProxy'),
  llmProxy: document.getElementById('llmProxy'),
  chromePath: document.getElementById('chromePath'),
  maxPages: document.getElementById('maxPages'),
  maxJobs: document.getElementById('maxJobs'),
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
    chromeProxy: fields.chromeProxy.value,
    llmProxy: fields.llmProxy.value,
    chromePath: fields.chromePath.value,
    maxPages: fields.maxPages.value,
    maxJobs: fields.maxJobs.value,
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
  window.jobsApi
    .chatSend({
      apiKey: fields.apiKey.value,
      model: fields.model.value,
      llmProxy: fields.llmProxy.value,
      message: text,
      resumeText: resumeText.value,
      onlyOpen: onlyOpenToggle.checked
    })
    .then((res) => {
      if (!res.ok) {
        appendChat('assistant', `请求失败: ${res.error}`);
        return;
      }
      const result = res.result || {};
      const lines = [];
      if (result.summary) {
        lines.push(`总结: ${result.summary}`);
      }
      const recs = Array.isArray(result.recommendations) ? result.recommendations : [];
      if (recs.length) {
        lines.push(`推荐 ${recs.length} 个:`);
        for (const rec of recs.slice(0, 8)) {
          const score = rec.score ?? '-';
          const title = rec.title || '未命名职位';
          const company = rec.company || '未知公司';
          const url = rec.applyUrl || rec.jobUrl || '';
          lines.push(`- ${title} | ${company} | 分数 ${score} | ${url}`);
        }
      } else {
        lines.push('没有匹配的岗位。');
      }
      const excluded = Array.isArray(result.excluded) ? result.excluded : [];
      if (excluded.length) {
        lines.push(`排除 ${excluded.length} 个（示例）:`);
        for (const ex of excluded.slice(0, 5)) {
          const title = ex.title || '未命名职位';
          const reason = ex.reason || '';
          lines.push(`- ${title} ${reason ? `(${reason})` : ''}`);
        }
      }
      const need = Array.isArray(result.needsConfirmation) ? result.needsConfirmation : [];
      if (need.length) {
        lines.push(`需确认 ${need.length} 个（示例）:`);
        for (const ex of need.slice(0, 5)) {
          const title = ex.title || '未命名职位';
          const reason = ex.reason || '';
          lines.push(`- ${title} ${reason ? `(${reason})` : ''}`);
        }
      }
      appendChat('assistant', lines.join('\n'));
    })
    .catch((err) => {
      appendChat('assistant', `请求失败: ${err.message}`);
    });
});
