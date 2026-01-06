# SmartEdu Recorder

## 1) Start Chrome with CDP

Run Chrome with a dedicated profile and remote debugging enabled:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-cdp-smartedu" \
  --no-first-run --no-default-browser-check
```

Log in to https://basic.smartedu.cn/ and stop on the course list page.

## 2) Install deps

```bash
npm install
```

## 3) Start recorder

```bash
npm run record
```

The recorder will log events to `recordings/recording-<timestamp>.jsonl`.

## 4) Manual marks (optional but recommended)

- `Ctrl+Shift+1` when playback starts
- `Ctrl+Shift+2` when playback finishes / completion appears
- `Ctrl+Shift+3` when you return to the course list

These marks make it easier to build a stable automation plan.
