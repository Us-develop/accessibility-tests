import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexAstro = readFileSync(join(repoRoot, 'web/src/pages/index.astro'), 'utf8');

function formBlock(id) {
  const re = new RegExp(`<form[\\s\\S]*?id="${id}"[\\s\\S]*?>`);
  const match = indexAstro.match(re);
  assert.ok(match, `expected <form id="${id}">`);
  return match[0];
}

describe('home scan forms', () => {
  it('posts signed-in and guest scans instead of GET /?url=', () => {
    for (const id of ['guest-run-form', 'customer-run-form', 'run-form']) {
      const open = formBlock(id);
      assert.match(open, /method="post"/);
      assert.match(open, /action="\/api\/run"/);
      assert.match(open, /data-astro-reload/);
    }
  });

  it('intercepts scan submits in capture phase so ClientRouter cannot navigate to ?url=', () => {
    assert.match(indexAstro, /__wcagHomeScanBound/);
    assert.match(indexAstro, /addEventListener\(\s*'submit'/);
    assert.match(indexAstro, /form\.id === 'customer-run-form'/);
    assert.match(indexAstro, /event\.preventDefault\(\)/);
    assert.match(indexAstro, /event\.stopPropagation\(\)/);
    assert.match(indexAstro, /true\s*\)/);
    assert.match(indexAstro, /astro:page-load/);
  });
});
