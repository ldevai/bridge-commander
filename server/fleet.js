'use strict';
// fleet.js — WHICH workspace `bc` acts on when nobody said, and what its tmux
// sessions are called. Node built-ins only, zero deps; shared by the CLI and
// the server.
//
// Two facts live here because they are the same fact from two sides: a fleet
// nobody has to `cd` into needs a fixed home on disk, and agents nobody has to
// hunt for need a fixed name in tmux. Both are defaults, both are overridable,
// and both are written down in the workspace's own config.json the moment a
// fleet is founded — so a later `bc` call reads them rather than re-deriving
// them from an environment that may have moved.
const fs = require('fs');
const os = require('os');
const path = require('path');

// The default fleet: ~/.config/bridge-commander (XDG_CONFIG_HOME when set).
// BC_FLEET overrides it wholesale — one env var to point a shell, a cron entry
// or a test at another fleet without repeating --workspace on every call.
const DEFAULT_FLEET_NAME = 'bridge-commander';
function defaultFleetDir() {
  const explicit = String(process.env.BC_FLEET || '').trim();
  if (explicit) return path.resolve(explicit);
  const xdg = String(process.env.XDG_CONFIG_HOME || '').trim();
  const base = xdg ? path.resolve(xdg) : path.join(os.homedir(), '.config');
  return path.join(base, DEFAULT_FLEET_NAME);
}

// The home state dir (~/.bridge-commander) — the harness fallback state lives
// here, and so does the machine-wide tmux-name registry below. BC_HOME_STATE is
// a test seam: the registry is machine state, and a test that wrote to the real
// one would claim names out from under a running fleet.
function homeStateDir() {
  const explicit = String(process.env.BC_HOME_STATE || '').trim();
  return explicit ? path.resolve(explicit) : path.join(os.homedir(), '.bridge-commander');
}

// ---------- tmux session names ----------
// The default base every spawned session is named after. A lieutenant's session
// is `<base>-lt-<id>`; its workers are windows inside it. Fixed and guessable on
// purpose — `tmux attach -t bridge-commander-lt-bridget` is the whole point.
const DEFAULT_TMUX_SESSION = 'bridge-commander';

// tmux forbids dots and colons in session names, and a name that does not start
// with a letter can be read as an index. Anything that survives this is safe to
// hand tmux verbatim; null means "not a usable name".
function sanitizeSessionName(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(s) ? s : null;
}

// ---------- the machine-wide name registry ----------
// Two fleets that both took the default name would mint the same session names
// for same-named lieutenants, and the second spawn would die on tmux's own
// "session already exists" — long after the choice that caused it. So a fleet
// CLAIMS its base name when it is founded, and a claim already held by another
// workspace that still exists on disk sends the newcomer to a suffixed name.
//
// The registry is advisory and self-healing: a claim whose workspace is gone is
// stale and reusable, and an unreadable registry claims nothing rather than
// blocking a boot.
function registryFile() { return path.join(homeStateDir(), 'sessions.json'); }
function readRegistry() {
  try {
    const r = JSON.parse(fs.readFileSync(registryFile(), 'utf8'));
    if (r && typeof r === 'object' && !Array.isArray(r)) return r;
  } catch (e) { /* absent or corrupt — claims nothing */ }
  return {};
}
function writeRegistry(reg) {
  try {
    fs.mkdirSync(homeStateDir(), { recursive: true });
    fs.writeFileSync(registryFile(), JSON.stringify(reg, null, 2) + '\n');
    return true;
  } catch (e) { return false; }
}
function sameDir(a, b) {
  const real = (p) => { try { return fs.realpathSync(p); } catch (e) { return path.resolve(p); } };
  return real(a) === real(b);
}

// claimSessionName(workspace, wanted, disc) -> { name, conflict }
//   name     the base this workspace may use (wanted, or wanted-<disc> when taken)
//   conflict the workspace holding `wanted`, when it was not free
// Idempotent: a workspace re-claiming its own name gets it back unchanged.
function claimSessionName(workspace, wanted, disc) {
  const want = sanitizeSessionName(wanted) || DEFAULT_TMUX_SESSION;
  const reg = readRegistry();
  const holder = reg[want];
  let conflict = null;
  let name = want;
  if (holder && !sameDir(holder, workspace) && fs.existsSync(holder)) {
    conflict = holder;
    name = sanitizeSessionName(want + '-' + disc) || want;
  }
  reg[name] = path.resolve(workspace);
  writeRegistry(reg);
  return { name, conflict };
}

// releaseSessionName(workspace) — drop every claim this workspace holds. Called
// when a fleet is torn down, so the name is free for the next one.
function releaseSessionName(workspace) {
  const reg = readRegistry();
  let changed = false;
  for (const [name, dir] of Object.entries(reg)) {
    if (sameDir(dir, workspace)) { delete reg[name]; changed = true; }
  }
  if (changed) writeRegistry(reg);
  return changed;
}

module.exports = {
  DEFAULT_FLEET_NAME, DEFAULT_TMUX_SESSION,
  defaultFleetDir, homeStateDir,
  sanitizeSessionName, claimSessionName, releaseSessionName, registryFile,
};
