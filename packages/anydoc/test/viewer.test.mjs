import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertWithinByteLimit,
  createAbortScope,
  getCapabilities,
  isMacroEnabled,
  isSafeExternalUrl,
  sanitizeFilename,
  decodeTextContent,
} from '../index.js';
import { loadViewerAdapter } from '../src/adapters.js';

test('capabilities distinguish v1 viewers from ingestion-only formats', () => {
  assert.equal(getCapabilities('xlsx').viewing, 'native');
  assert.equal(getCapabilities('docm').viewing, 'none');
  assert.equal(isMacroEnabled('XLSM'), true);
});

test('unsafe URLs and filenames are inert', () => {
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
  assert.equal(isSafeExternalUrl('/relative.png'), false);
  assert.equal(isSafeExternalUrl('https://example.test/file'), true);
  assert.equal(sanitizeFilename('a\n../../b'), 'a_.._.._b');
});

test('limits and cancellation are explicit', () => {
  assert.throws(() => assertWithinByteLimit(11 * 1024 * 1024, 'text'), { code: 'too-large' });
  const scope = createAbortScope();
  assert.equal(scope.signal.aborted, false);
  scope.abort();
  assert.equal(scope.signal.aborted, true);
});

test('text and Markdown use bounded UTF-8 passthrough ingestion', () => {
  assert.deepEqual(decodeTextContent(new TextEncoder().encode('hello')), {
    format: 'text',
    text: 'hello',
    markdown: undefined,
  });
  assert.equal(getCapabilities('markdown').ingestion, 'passthrough');
  assert.throws(() => decodeTextContent(new Uint8Array([0xff])), { code: 'invalid-text' });
});

test('format adapters resolve real lazy viewer packages', async () => {
  const [react, spreadsheet, presentation] = await Promise.all([
    loadViewerAdapter('pdf'),
    loadViewerAdapter('xlsx'),
    loadViewerAdapter('pptx'),
  ]);
  assert.equal(typeof react.PdfViewer, 'function');
  assert.equal(typeof spreadsheet.SpreadsheetViewer, 'function');
  assert.equal(typeof presentation.PresentationViewer, 'function');
});
