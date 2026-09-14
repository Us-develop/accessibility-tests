/** Dated legal-document versions recorded on consent rows and page footers. */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEGAL_TERMS_VERSION = '2026-09-14';
export const LEGAL_PRIVACY_VERSION = '2026-09-14';

export const WITHDRAWAL_WAIVER_TEXT =
  'I request immediate delivery of the digital service and acknowledge that I lose my 14-day right of withdrawal once delivery starts.';

export const LEAD_PRIVACY_NOTICE =
  'We use these details only to contact you about this request. See our Privacy Notice.';

export function isTruthyFlag(value) {
  if (value === true) return true;
  const raw = String(value ?? '').trim().toLowerCase();
  return raw === 'true' || raw === 'on' || raw === '1' || raw === 'yes';
}

export function readSubprocessorsMarkdown() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', 'docs', 'SUBPROCESSORS.md'),
    join(process.cwd(), 'docs', 'SUBPROCESSORS.md'),
    join(process.cwd(), '..', 'docs', 'SUBPROCESSORS.md'),
  ];
  for (const file of candidates) {
    if (existsSync(file)) return readFileSync(file, 'utf8');
  }
  throw new Error('docs/SUBPROCESSORS.md was not found.');
}
