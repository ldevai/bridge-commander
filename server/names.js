'use strict';
// names — workspace-scoped session naming (docs/api/overview.md, harness port:
// "spawned session names are unique per workspace"). Two boards on one machine
// must never collide on tmux session names, so every generated name carries a
// workspace discriminator: the ASCII slug of the workspace basename (truncated)
// plus a short hash of the absolute workspace path. Deterministic — the same
// workspace always yields the same names across restarts.
//
// tmux session names cannot contain dots or colons; everything emitted here is
// [A-Za-z0-9-] only, so emoji or any non-ASCII in a workspace or id never
// reach tmux.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { STATE_DIR_NAME, LEGACY_STATE_DIR_NAME } = require('./statedir.js');
const { DEFAULT_TMUX_SESSION, sanitizeSessionName } = require('./fleet.js');

// workspaceDisc(workspace) -> short stable discriminator for the workspace.
// Symlinked paths resolve to one canonical form so the same board gets the
// same discriminator no matter how it was addressed.
function workspaceDisc(workspace) {
  let abs = path.resolve(workspace);
  try { abs = fs.realpathSync(abs); } catch (e) { /* not on disk yet — hash the resolved form */ }
  const hash = crypto.createHash('sha256').update(abs).digest('hex').slice(0, 6);
  const slug = path.basename(abs).toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 12).replace(/-+$/, '');
  return slug ? slug + '-' + hash : hash;
}

function safe(id) { return String(id).replace(/[^A-Za-z0-9_-]/g, '-'); }

// sessionBase(workspace) -> the stem every spawned session name is built on.
//
// A workspace that NAMES itself (config.json "tmuxSession", or BC_TMUX_SESSION
// for a one-off) gets that name verbatim: `bridge-commander-lt-bridget` is a
// name a person can type into `tmux attach` without looking it up, which is the
// whole reason the key exists. `bc start` writes it when it founds a fleet.
//
// A workspace that does NOT name itself keeps the derived `bc-<disc>` stem it
// has always had. That is not a fallback for tidiness — it is the compatibility
// contract: every session name already recorded in a board.json, and every
// lieutenant living in one right now, was built on it.
function configuredSessionBase(workspace) {
  const env = sanitizeSessionName(process.env.BC_TMUX_SESSION);
  if (env) return env;
  for (const name of [STATE_DIR_NAME, LEGACY_STATE_DIR_NAME]) {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(workspace, name, 'config.json'), 'utf8'));
      if (c && typeof c === 'object' && c.tmuxSession) return sanitizeSessionName(c.tmuxSession);
    } catch (e) { /* absent or corrupt — not named */ }
  }
  return null;
}

function sessionBase(workspace) {
  return configuredSessionBase(workspace) || ('bc-' + workspaceDisc(workspace));
}

function lieutenantSession(workspace, id) {
  return sessionBase(workspace) + '-lt-' + safe(id);
}

// isOurSession(workspace, name) — is this a name WE minted, and may therefore
// re-create? A respawn reuses the session name it finds (an incarnation, not a
// new entity), but only when the name is one of ours: the founding lieutenant's
// session is whatever tmux session the human happened to be sitting in, and
// re-creating `main` or `0` is not respawning a lieutenant.
//
// `bc-*` stays in the answer forever. It was the only shape names came in
// before this fleet's stem was configurable, and refs are data that outlive the
// config that made them.
const LEGACY_SESSION = /^bc-[A-Za-z0-9_-]+$/;
function isOurSession(workspace, name) {
  if (!name) return false;
  const base = sessionBase(workspace);
  return name === base || name.startsWith(base + '-') || LEGACY_SESSION.test(name);
}

// workerWindow(cardId) -> tmux window name for a card's worker inside its
// owning lieutenant's session (papercut #8). The 'w-' prefix guarantees the
// name can never read as a bare number, which tmux would parse as a window
// INDEX instead of a name. No workspace discriminator: the enclosing
// lieutenant session already carries it, and card ids are unique per board.
function workerWindow(cardId) {
  return 'w-' + safe(cardId);
}

// LIEUTENANT_WINDOW — the window a lieutenant lives in inside its OWN session.
// A lieutenant cohabits that session with its worker windows, so its ref must
// be window-granular too: a session-granular ref kills the whole session on
// revive (every worker with it) and reads liveness off whichever window has
// focus (a busy worker masks a dead lieutenant). Same name for every
// lieutenant — the session name already identifies which one.
const LIEUTENANT_WINDOW = 'lt';

module.exports = {
  workspaceDisc, sessionBase, configuredSessionBase, lieutenantSession, isOurSession,
  workerWindow, LIEUTENANT_WINDOW, DEFAULT_TMUX_SESSION,
};
