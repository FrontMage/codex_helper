# Node + LLM Web Automation Reference

## Candidate schema (minimal)

Use a stable, index-based schema so LLM can return IDs only:

```json
{
  "candidateId": 12,
  "frameId": 0,
  "domIndex": 183,
  "text": "Lesson title",
  "href": "",
  "resourceId": "",
  "dataKey": "",
  "reason": "outline"
}
```

Keep `text` short (<= 80 chars). Prefer `resourceId`/`dataKey`/`href` if present.

## Prompt template (single shot)

System:
- Return ONLY JSON: `{ "items": [{"candidateId": number}] }`
- Choose items that represent lessons/videos, not nav/search/login/filter.
- Preserve DOM order using `domIndex`.

User payload:
- `courseUrl`
- `instructions`
- `candidates[]`

## Heuristic pre-filter

- Prefer candidates with `resourceId` or `dataKey` or non-empty `href`.
- Drop overly long or empty text items.
- Sort by `domIndex`.

If heuristic results are already clean, skip the LLM.

## Playback loop checklist

1. Click the candidate element.
2. Wait for `video` in the main frame.
3. Force `video.muted = true` and `video.playbackRate = 2` (or max allowed).
4. If `video.paused`, call `video.play()` and retry a few times.
5. Poll every 5–10s: log `currentTime/duration`.
6. Stop when `currentTime >= duration - 0.5` or a completion marker appears.

## Failure dump

Capture on failure:
- URL
- candidate metadata
- `document.title`
- serialized DOM of the course list container
- screenshot of viewport

## Cost controls

- One LLM call per page load.
- Cache selection by URL and list hash.
- Reduce payload size: no innerHTML, no large attributes, truncate text.
- Do not call LLM while video is playing.

## Minimal JS snippets

Get all videos:
```js
Array.from(document.querySelectorAll('video'))
```

Get progress:
```js
const v = document.querySelector('video');
({ current: v?.currentTime ?? 0, duration: v?.duration ?? 0, rate: v?.playbackRate ?? 1 })
```

Set 2x + mute:
```js
const v = document.querySelector('video');
if (v) { v.muted = true; v.playbackRate = 2; }
```
