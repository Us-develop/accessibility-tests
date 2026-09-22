import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const layout = readFileSync(join(repoRoot, 'web/src/layouts/Layout.astro'), 'utf8');
const appCss = readFileSync(join(repoRoot, 'web/public/styles/app.css'), 'utf8');

describe('staff session banner', () => {
  it('is in the shared layout and only staff CSS shows it', () => {
    assert.match(layout, /id="wcag-staff-banner"/);
    assert.match(layout, /You are logged in as staff/);
    assert.match(layout, /role="status"/);
    assert.match(layout, /signedRole === 'staff' \? 'is-staff'/);
    assert.match(appCss, /\.wcag-staff-banner/);
    assert.match(appCss, /background:\s*#000/);
    assert.match(appCss, /body\.is-staff \.wcag-staff-banner/);
    assert.match(appCss, /display:\s*block/);
  });

  it('stays off the printed page', () => {
    assert.match(layout, /@media print[\s\S]*\.wcag-staff-banner/);
  });
});
