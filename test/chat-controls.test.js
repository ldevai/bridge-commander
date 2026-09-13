'use strict';
// Composer controls bind DOM at import. Keep the behavior contract close to
// the source while server-side cancellation is exercised in chat.test.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ui = (...p) => path.join(__dirname, '..', 'ui', ...p);
const html = fs.readFileSync(ui('index.html'), 'utf8');
const chat = fs.readFileSync(ui('js', 'chat.js'), 'utf8');
const switcher = fs.readFileSync(ui('js', 'ltswitcher.js'), 'utf8');

test('composer defaults to Enter-send, keeps Shift+Enter for a line, and can be toggled', () => {
  assert.match(html, /id="chat-enter-mode"/);
  assert.match(chat, /const ENTER_SEND_KEY = 'bc-chat-enter-sends';/);
  assert.match(chat, /enterSends && !e\.shiftKey && !e\.isComposing/);
  assert.match(chat, /enterModeBtn\.onclick = \(\) => \{/);
});

test('the immediate Stop control cancels the delivered queue item', () => {
  assert.match(html, /id="chat-interrupt"/);
  assert.match(chat, /api\.cancelFeedback\(item\.seq, item\.target\)/);
  assert.match(chat, /message cancelled — response interrupted/);
  assert.match(chat, /e\.status === 404 \|\| e\.status === 409/);
  assert.match(chat, /showInterruptNotice\('message already stopped'\)/);
});

test('the lieutenant ellipsis menu exposes direct model and effort picks', () => {
  assert.match(switcher, /tune\.className = 'mm-tune';/);
  assert.match(switcher, /api\.updateLieutenant\(ltId, \{ model: want \|\| null \}\)/);
  assert.match(switcher, /api\.updateLieutenant\(ltId, \{ effort: effort\.value \|\| null \}\)/);
});
