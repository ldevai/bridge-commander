'use strict';
// ui/js/chatdraft.js — draft ownership is independent of the one visible
// textarea, so switching lieutenants hides a draft without losing it.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let createDraftStore;
test.before(async () => {
  ({ createDraftStore } = await import(pathToFileURL(path.join(__dirname, '..', 'ui', 'js', 'chatdraft.js')).href));
});

test('composer drafts are isolated by chat target and restore on return', () => {
  const drafts = createDraftStore();
  drafts.set('lieutenant:ada', 'follow up on the deploy');
  assert.strictEqual(drafts.get('lieutenant:grace'), '', 'another lieutenant opens with a cleared composer');
  assert.strictEqual(drafts.get('lieutenant:ada'), 'follow up on the deploy', 'switching back restores the earlier text');
});

test('clearing a composer discards its saved draft', () => {
  const drafts = createDraftStore();
  drafts.set('lieutenant:ada', 'no longer needed');
  drafts.set('lieutenant:ada', '');
  assert.strictEqual(drafts.get('lieutenant:ada'), '');
});
