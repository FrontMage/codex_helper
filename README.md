# SmartEdu Runner

基于 Electron + Puppeteer 的课程辅助工具，用于在 Chrome 中自动化播放课程并记录学习进度（需用户手动登录/验证码）。

## 功能概览
- 桌面 GUI：配置参数、查看实时日志、一键导出支持包
- 自动化播放：逐条播放课程目录项、静音、2x 播放（可配置）
- 支持包导出：打包 `recordings/` 与内存日志

## 快速开始

### 1) 安装依赖
```bash
cnpm install
```

### 2) 运行 GUI
```bash
npm run gui
```

### 3) 使用说明
- 填写 OpenRouter API Key / 模型 / 代理等参数
- 点击 **开始运行**
- 在弹出的 Chrome 中完成登录与验证码
- 回到 GUI 点击 **登录后继续**

## 重要说明
- **需要本机已安装 Chrome**（不是 Electron 内置 Chromium）。
- 自动化提示栏可通过勾选“隐藏自动化提示”尝试隐藏（不保证 100% 生效）。
- 课程播放速度受平台限制（默认 2x）。

## 环境变量（高级）
GUI 会映射为这些变量，也可手动执行脚本：

```bash
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openai/gpt-5.1-codex
HTTPS_PROXY=http://localhost:8080
START_URL=https://auth.smartedu.cn/uias/login
COURSE_URL=https://basic.smartedu.cn/teacherTraining/courseDetail?... 
PLAYBACK_RATE=2
POLL_INTERVAL_MS=10000
HIDE_AUTOMATION_INFOBAR=1
```

## 打包（Windows）
GitHub Actions 已配置 Windows 构建（见 `.github/workflows/build-windows.yml`）。

本地构建（Windows 环境）：
```bash
cnpm install
npm run dist:win
```

## License
PolyForm Noncommercial 1.0.0
- 允许非商业使用
- **禁止商业用途**（若商业使用需另行授权）

详细条款见 `LICENSE`。
