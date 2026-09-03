import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_MANUAL_ITEMS, resolvePersistedManualChecked } from '../manual-checklist.js';

const a = ALL_MANUAL_ITEMS[0].id;
const b = ALL_MANUAL_ITEMS[1].id;

describe('resolvePersistedManualChecked', () => {
  it('uses the run file even when it is empty', () => {
    assert.deepEqual(
      resolvePersistedManualChecked({
        runFileExists: true,
        runChecked: [],
        dbChecked: [a],
        domainChecked: [b],
      }),
      []
    );
  });

  it('keeps run-file ticks over domain ticks', () => {
    assert.deepEqual(
      resolvePersistedManualChecked({
        runFileExists: true,
        runChecked: [a],
        domainChecked: [b],
      }),
      [a]
    );
  });

  it('falls back to domain ticks when this run has never been saved', () => {
    assert.deepEqual(
      resolvePersistedManualChecked({
        runFileExists: false,
        runChecked: [],
        dbChecked: [],
        domainChecked: [a, b],
      }),
      [a, b]
    );
  });

  it('prefers non-empty DB ticks over the domain file', () => {
    assert.deepEqual(
      resolvePersistedManualChecked({
        runFileExists: false,
        dbChecked: [a],
        domainChecked: [b],
      }),
      [a]
    );
  });
});
