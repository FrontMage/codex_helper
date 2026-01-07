import fs from 'node:fs';
import path from 'node:path';
import { callOpenRouter, extractJson } from './llm.js';

function trimText(text, maxLen) {
  if (!text) return '';
  return text.length <= maxLen ? text : text.slice(0, maxLen);
}

export function loadJobs(dataDir) {
  const filePath = path.join(dataDir, 'jobs.jsonl');
  if (!fs.existsSync(filePath)) {
    throw new Error('jobs.jsonl not found. Run crawl first.');
  }
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

export function loadResume(dataDir) {
  const filePath = path.join(dataDir, 'resume.md');
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

export async function recommendJobs({
  apiKey,
  model,
  llmProxy,
  resumeText,
  userMessage,
  jobs,
  limit = 80,
  onlyOpen = true
}) {
  if (!apiKey) throw new Error('Missing API key.');

  const usableJobs = jobs
    .filter((job) => job.applyUrl)
    .filter((job) => (onlyOpen ? job.isClosed !== true : true))
    .slice(0, limit)
    .map((job) => ({
      jobUrl: job.jobUrl,
      applyUrl: job.applyUrl,
      title: job.title || '',
      company: job.company || '',
      location: job.location || '',
      summary: trimText(job.summary || '', 800),
      requirements: job.requirements || [],
      responsibilities: job.responsibilities || [],
      benefits: job.benefits || [],
      closedReason: job.closedReason || ''
    }));

  const payload = {
    resume: trimText(resumeText, 6000),
    userRequirements: trimText(userMessage || '', 1200),
    jobs: usableJobs
  };

  const messages = [
    {
      role: 'system',
      content: [
        'You are a job matching assistant.',
        'Use the resume and user requirements to select the best jobs.',
        'Apply hard filters strictly (e.g., location restrictions, work authorization, region-only remote, visa requirements).',
        'Exclude jobs that violate constraints, and explain in excluded list.',
        'If a constraint is unclear, put the job into needsConfirmation with reason.',
        'Return ONLY JSON with schema:',
        '{"recommendations":[{"jobUrl":"","applyUrl":"","title":"","company":"","score":0,"fitReason":"","risks":[],"location":"","workAuth":""}],',
        '"excluded":[{"jobUrl":"","title":"","reason":""}],',
        '"needsConfirmation":[{"jobUrl":"","title":"","reason":""}],',
        '"summary":""}'
      ].join(' ')
    },
    {
      role: 'user',
      content: JSON.stringify(payload)
    }
  ];

  const raw = await callOpenRouter({ apiKey, model, messages, proxy: llmProxy });
  const parsed = extractJson(raw);
  if (!parsed) {
    return { raw, recommendations: [], excluded: [], needsConfirmation: [], summary: '' };
  }
  return parsed;
}
