/**
 * Optional Anthropic write-up of the deterministic WCAG coverage matrix.
 * The model explains the matrix; it does not decide conformance.
 */
import { createHash } from 'node:crypto';
import {
  buildWcagCoverage,
  compactCoverageForPrompt,
  buildStaticNarrative,
} from './wcag-coverage.js';

const ANALYSIS_VERSION = 1;

const SYSTEM_PROMPT = `You write a WCAG 2.2 Level A and AA coverage explanation for a Belgian accessibility scanner (Us).

You receive a JSON matrix that is the source of truth. Do not invent success criteria, scores, or findings. Do not contradict the matrix.

Hard rules:
- Do not say the website is fully, partially, or not conformant with WCAG or the EAA.
- Do not say completing the in-app checklist makes the site fully compliant or legally safe.
- Do not call this an official audit, certification, or EN 301 549 evaluation.
- You may say: if automated findings are fixed AND the manual/assistive-technology checks are actually performed well (keyboard, screen reader, zoom — not just ticking boxes), the customer will have covered what this product is designed to catch. That path is necessary for WCAG 2.2 AA. It is not sufficient: criteria listed as outsideProduct still need a professional.
- Always tell them to contact Us or another qualified professional for an official evaluation before publishing a conformance claim.

Write in clear English for a non-specialist. No markdown headings. Plain paragraphs.

Return ONLY JSON with keys:
checked, notChecked, manualCanCover, pathToConformance, disclaimer
Each value is 1–3 short paragraphs (plain text).`;

export function anthropicConfigured() {
  return Boolean(String(process.env.ANTHROPIC_API_KEY || '').trim());
}

export function coverageHash(compact) {
  return createHash('sha256').update(JSON.stringify(compact)).digest('hex').slice(0, 24);
}

function parseNarrativeJson(text) {
  const trimmed = String(text || '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object') return null;
    const keys = ['checked', 'notChecked', 'manualCanCover', 'pathToConformance', 'disclaimer'];
    const out = {};
    for (const k of keys) {
      if (typeof parsed[k] !== 'string' || !parsed[k].trim()) return null;
      out[k] = parsed[k].trim();
    }
    return out;
  } catch {
    return null;
  }
}

function narrativeLooksUnsafe(narrative) {
  const blob = Object.values(narrative).join('\n');
  const positiveClaims = [
    /\byou are fully compliant\b/i,
    /\bsite is fully compliant\b/i,
    /\bwebsite is fully compliant\b/i,
    /\bwill be fully compliant\b/i,
    /\bare fully compliant\b/i,
    /\bis fully conformant\b/i,
    /\bwill be fully conformant\b/i,
    /\bthis is an official (audit|evaluation)\b/i,
  ];
  return positiveClaims.some((re) => re.test(blob));
}

export async function requestAnthropicNarrative(compact) {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    return { ok: false, reason: 'not-configured' };
  }
  const model = String(process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5').trim() || 'claude-sonnet-4-5';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1800,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Write the five JSON fields from this coverage matrix:\n${JSON.stringify(compact)}`,
        },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { ok: false, reason: `http-${res.status}`, detail: errText.slice(0, 400) };
  }
  const data = await res.json();
  const text = Array.isArray(data?.content)
    ? data.content.map((b) => (b && b.type === 'text' ? b.text : '')).join('\n')
    : '';
  const narrative = parseNarrativeJson(text);
  if (!narrative) return { ok: false, reason: 'bad-json' };
  if (narrativeLooksUnsafe(narrative)) return { ok: false, reason: 'unsafe-claims' };
  return { ok: true, narrative, model };
}

/**
 * @param {object} reportData
 * @param {string[]} manualCheckedIds
 * @param {{ forceLlm?: boolean, cached?: object | null }} [opts]
 */
export async function buildWcagAnalysisPayload(reportData, manualCheckedIds, opts = {}) {
  const coverage = buildWcagCoverage(reportData, manualCheckedIds);
  const compact = compactCoverageForPrompt(coverage);
  const hash = coverageHash(compact);
  const llmAvailable = anthropicConfigured();
  const staticNarrative = buildStaticNarrative(coverage);

  const cached = opts.cached && typeof opts.cached === 'object' ? opts.cached : null;
  const cacheHit =
    cached &&
    cached.version === ANALYSIS_VERSION &&
    cached.hash === hash &&
    cached.narrative &&
    typeof cached.narrative.checked === 'string';

  if (cacheHit && !opts.forceLlm) {
    return {
      coverage,
      narrative: cached.narrative,
      source: cached.source || 'static',
      model: cached.model || null,
      hash,
      llmAvailable,
    };
  }

  let source = 'static';
  let narrative = staticNarrative;
  let model = null;
  let llmError = null;

  if (llmAvailable && opts.forceLlm) {
    try {
      const result = await requestAnthropicNarrative(compact);
      if (result.ok) {
        source = 'anthropic';
        narrative = result.narrative;
        model = result.model;
      } else {
        llmError = result.reason;
      }
    } catch (err) {
      llmError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    coverage,
    narrative,
    source,
    model,
    hash,
    llmAvailable,
    llmError,
  };
}

export function analysisCacheBody(payload) {
  return {
    version: ANALYSIS_VERSION,
    hash: payload.hash,
    source: payload.source,
    model: payload.model,
    generatedAt: new Date().toISOString(),
    narrative: payload.narrative,
  };
}
