'use strict';
// The card detail makes the worker pane discoverable exactly while there is
// live, card-bound work. detail.js binds its DOM at import, so pin this small
// wiring contract at source level (the pane stream itself is covered by pane.test).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ui = (...p) => path.join(__dirname, '..', 'ui', ...p);
const html = fs.readFileSync(ui('index.html'), 'utf8');
const detail = fs.readFileSync(ui('js', 'detail.js'), 'utf8');
const css = fs.readFileSync(ui('app.css'), 'utf8');

test('an active card detail offers its live worker view and opens its card pane', () => {
  assert.match(html, /<button id="dt-live-work"[^>]*hidden[^>]*>👁 work<\/button>/);
  assert.match(detail, /import \{ openCardPane \} from '\.\/pane\.js';/);
  assert.match(detail, /getElementById\('dt-live-work'\)\.onclick = \(\) => \{\s*if \(S\.openCardId\) openCardPane\(S\.openCardId\);/);
  const workerAt = detail.indexOf('const worker = !arch');
  const visibilityAt = detail.indexOf("getElementById('dt-live-work').hidden = !worker;");
  assert.ok(workerAt !== -1 && visibilityAt > workerAt, 'visibility follows the live-worker derivation');
});

test('the live-work control is styled as a quiet detail-header action', () => {
  assert.match(css, /#dt-live-work \{[^}]*color: var\(--dim\)/);
  assert.match(css, /#dt-live-work:hover \{[^}]*color: var\(--accent\)/);
});
