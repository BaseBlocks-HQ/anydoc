import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertWithinLimit,
  createAbortScope,
  getCapabilities,
  isMacroEnabled,
  isSafeExternalUrl,
  sanitizeFilename,
} from '../index.js';

test('capabilities distinguish v1 viewers from ingestion-only formats', () => {
  assert.equal(getCapabilities('xlsx').view, true);
  assert.equal(getCapabilities('docm').view, false);
  assert.equal(isMacroEnabled('xlsm'), true);
});

test('unsafe URLs and filenames are inert', () => {
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
  assert.equal(isSafeExternalUrl('https://example.test/file'), true);
  assert.equal(sanitizeFilename('a\n../../b'), 'a_.._.._b');
});

test('limits and cancellation are explicit', () => {
  assert.throws(() => assertWithinLimit(11 * 1024 * 1024, 'text'), { code: 'too-large' });
  const scope = createAbortScope();
  assert.equal(scope.signal.aborted, false);
  scope.abort();
  assert.equal(scope.signal.aborted, true);
});
