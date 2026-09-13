'use strict';
// `bc start` / `bc stop` / `bc agents` — the captain's door.
//
// The three things that were unclear before this existed, each asserted here:
// where a fleet lives when nobody said (the default fleet, no cd), what its
// tmux sessions are called (a stem you can type, claimed so two fleets never
// mint the same names), and whether the agents are still running after a
// restart (the roster, probed).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startServerWithLieutenant, freePort, retryOnPortClash, runCli, LT } = require('./helper');

const BC = path.join(__dirname, '..', 'cli', 'bc');

function tmp(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'bc-' + tag + '-')); }

// Everything the founding path can reach outside the temp dirs is redirected:
// HOME (the worker-duties skill symlink, the git identity) and BC_HOME_STATE
// (the machine-wide tmux-name registry — a test that wrote to the real one
// would claim names out from under the developer's own fleet).
function fleetEnv(home, extra = {}) {
  return Object.assign({
    HOME: home,
    BC_HOME_STATE: path.join(home, '.bridge-commander'),
    GIT_CONFIG_GLOBAL: path.join(home, 'gitconfig-none'),
    GIT_CONFIG_SYSTEM: '/dev/null',
    BC_FLEET: '',
    XDG_CONFIG_HOME: '',
  }, extra);
}

// Run the `bc` door specifically — the symlink is the product surface, and its
// own usage screen and messages hang off the name it was called by.
function runBc(args, env = {}, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BC, ...args], {
      cwd: cwd || path.join(__dirname, '..'),
      env: Object.assign({}, process.env, env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function config(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, '.bridge-commander', 'config.json'), 'utf8')); }
  catch (e) { return {}; }
}
function serverLog(dir) {
  try { return fs.readFileSync(path.join(dir, '.bridge-commander', 'server.log'), 'utf8'); }
  catch (e) { return ''; }
}

// `start` boots a server this test does not control, so it can lose the port
// between reserving the number and the server binding it. Same two faces as
// every other boot in the suite, same single reason to try again.
function startFleet(env, extra = []) {
  return retryOnPortClash(async () => {
    const port = await freePort();
    const r = await runBc(['start', '--port', String(port), '--harness', 'fake'].concat(extra), env);
    const dir = env.BC_FLEET;
    if (r.code !== 0 && /EADDRINUSE/.test(serverLog(dir))) throw new Error('EADDRINUSE: boot lost the port');
    if (r.code === 0 && !r.stdout.includes(':' + port + '/')) {
      throw new Error('EADDRINUSE: ' + port + ' was taken, the run moved: ' + r.stdout.trim());
    }
    return { port, r };
  });
}

test('bc start founds the DEFAULT fleet with no cd, no dir and no flags', async () => {
  const home = tmp('home');
  const fleet = path.join(home, '.config', 'bridge-commander');
  try {
    // XDG_CONFIG_HOME unset and HOME redirected: the default fleet is
    // ~/.config/bridge-commander, and it does not exist yet.
    assert.ok(!fs.existsSync(fleet), 'precondition: no fleet on disk');
    const env = fleetEnv(home, { BC_FLEET: fleet });
    const { r } = await startFleet(env);
    assert.strictEqual(r.code, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(fleet, '.bridge-commander', 'board.json')), 'a real workspace was founded');
    assert.match(r.stdout, /http:\/\/localhost:\d+\//);
    assert.match(r.stdout, /fleet:\s+\S/);
    // It ends by saying how to stop it — the other half of the pair that was missing.
    assert.match(r.stdout, /stop:\s+bc stop/);
    // …and Bridget is on it, chartered and spawned, the way the first run always left her.
    assert.match(r.stdout, /lieutenant "Bridget" \(bridget\) registered/);
  } finally {
    await runBc(['stop', '--workspace', path.join(home, '.config', 'bridge-commander')], fleetEnv(home));
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a founded fleet names its tmux sessions after a stem a person can type', async () => {
  const home = tmp('home');
  const fleet = path.join(home, 'fleet');
  fs.mkdirSync(fleet);
  try {
    const env = fleetEnv(home, { BC_FLEET: fleet });
    const { r, port } = await startFleet(env);
    assert.strictEqual(r.code, 0, r.stderr);
    // Written down, not derived on the fly: the next call reads it rather than
    // re-deriving it from an environment that may have moved.
    assert.strictEqual(config(fleet).tmuxSession, 'bridge-commander');
    assert.match(r.stdout, /tmux:\s+bridge-commander\b/);

    // The roster names the address, and the address is the stem + the lieutenant.
    const agents = await runBc(['agents', '--json', '--port', String(port)], env);
    assert.strictEqual(agents.code, 0, agents.stderr);
    const roster = JSON.parse(agents.stdout);
    assert.strictEqual(roster.tmux, 'bridge-commander');
    assert.strictEqual(roster.named, true);
    const bridget = roster.lieutenants.find((l) => l.id === 'bridget');
    assert.ok(bridget, 'Bridget is on the roster');
    assert.strictEqual(bridget.session, 'bridge-commander-lt-bridget');
    assert.strictEqual(bridget.address, 'bridge-commander-lt-bridget:lt');
    assert.strictEqual(bridget.state, 'live');
  } finally {
    await runBc(['stop', '--workspace', fleet], fleetEnv(home));
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('--session pins the stem, and a name another fleet already claimed never collides', async () => {
  const home = tmp('home');
  const first = path.join(home, 'first');
  const second = path.join(home, 'second');
  fs.mkdirSync(first); fs.mkdirSync(second);
  try {
    const envA = fleetEnv(home, { BC_FLEET: first });
    const a = await startFleet(envA, ['--session', 'armada']);
    assert.strictEqual(a.r.code, 0, a.r.stderr);
    assert.strictEqual(config(first).tmuxSession, 'armada');

    // The second fleet asks for the same name. Two fleets minting
    // `armada-lt-bridget` would collide inside tmux itself, long after the
    // choice that caused it — so the newcomer is moved and told.
    const envB = fleetEnv(home, { BC_FLEET: second });
    const b = await startFleet(envB, ['--session', 'armada']);
    assert.strictEqual(b.r.code, 0, b.r.stderr);
    assert.notStrictEqual(config(second).tmuxSession, 'armada');
    assert.match(config(second).tmuxSession, /^armada-/);
    assert.match(b.r.stderr, /already claimed by the fleet at/);
  } finally {
    await runBc(['stop', '--workspace', first], fleetEnv(home));
    await runBc(['stop', '--workspace', second], fleetEnv(home));
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('bc start is idempotent: a second one re-enters the fleet instead of founding another', async () => {
  const home = tmp('home');
  const fleet = path.join(home, 'fleet');
  fs.mkdirSync(fleet);
  try {
    const env = fleetEnv(home, { BC_FLEET: fleet });
    const { r, port } = await startFleet(env);
    assert.strictEqual(r.code, 0, r.stderr);

    const again = await runBc(['start', '--port', String(port), '--harness', 'fake'], env);
    assert.strictEqual(again.code, 0, again.stderr);
    assert.match(again.stdout, /server already running/);
    assert.match(again.stdout, /tmux:\s+bridge-commander/);
    assert.match(again.stdout, /lieutenant\s+bridget\s+live/);
    assert.doesNotMatch(again.stderr, /founding a new fleet/);
  } finally {
    await runBc(['stop', '--workspace', fleet], fleetEnv(home));
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('bc stop stops the board and SAYS which agent sessions it left running', async () => {
  const home = tmp('home');
  const fleet = path.join(home, 'fleet');
  fs.mkdirSync(fleet);
  try {
    const env = fleetEnv(home, { BC_FLEET: fleet });
    const { r, port } = await startFleet(env);
    assert.strictEqual(r.code, 0, r.stderr);

    const stop = await runBc(['stop', '--port', String(port)], env);
    assert.strictEqual(stop.code, 0, stop.stderr);
    assert.match(stop.stdout, /board stopped/);
    // The fact that was never stated: the agent outlives the board on purpose.
    assert.match(stop.stdout, /1 agent session\(s\) still running: bridge-commander-lt-bridget/);
    assert.match(stop.stdout, /they survive on purpose/);
    assert.match(stop.stdout, /bc stop --all/);

    // And the board really is down.
    const status = await runBc(['status', '--port', String(port)], env);
    assert.strictEqual(status.code, 1);
    assert.match(status.stdout, /server: down/);
    assert.match(status.stdout, /bc start` brings it up/);
  } finally {
    await runBc(['stop', '--workspace', fleet], fleetEnv(home));
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('bc status --agents answers "is anything still running" off the recorded refs', async () => {
  const s = await startServerWithLieutenant();
  const args = ['--workspace', s.dir, '--port', String(s.port)];
  try {
    // Ada has no ref at all — the honest answer is "no session", never "dead".
    let r = await runBc(['status', '--agents', ...args]);
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /lieutenant\s+ada\s+none\s+-\s+\(no session\)/);

    // Without --agents it costs nothing and names the door instead.
    r = await runBc(['status', ...args]);
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /tmux:\s+bc-.*-lt-<lieutenant>/);
    assert.match(r.stdout, /bc agents` probes what is live/);
  } finally {
    await s.stop();
  }
});

test('a fleet that never named itself keeps the session names its agents already answer to', async () => {
  const s = await startServerWithLieutenant();
  try {
    // No tmuxSession key: names stay derived, which is the compatibility
    // contract — every session name already recorded in a board.json was built
    // on the derived stem.
    const r = await runBc(['agents', '--json', '--workspace', s.dir, '--port', String(s.port)]);
    assert.strictEqual(r.code, 0, r.stderr);
    const roster = JSON.parse(r.stdout);
    assert.strictEqual(roster.named, false);
    assert.match(roster.tmux, /^bc-/);

    // Naming it is a deliberate act, and it says what it does and does not change.
    const set = await runCli(['config', 'session', 'flagship', '--workspace', s.dir, '--port', String(s.port)],
      { BC_HOME_STATE: path.join(s.dir, 'home-state') });
    assert.strictEqual(set.code, 0, set.stderr);
    assert.match(set.stdout, /tmuxSession=flagship/);
    assert.match(set.stdout, /already in a session keep theirs/);

    const after = await runBc(['agents', '--json', '--workspace', s.dir, '--port', String(s.port)]);
    assert.strictEqual(JSON.parse(after.stdout).tmux, 'flagship');
  } finally {
    await s.stop();
  }
});

test('bc with no fleet anywhere prints the four verbs, not a workspace error', async () => {
  const home = tmp('home');
  try {
    const r = await runBc([], fleetEnv(home), home);
    assert.strictEqual(r.code, 1); // usage exits non-zero, as it always has
    assert.match(r.stderr, /bc start \[<dir>\]/);
    assert.match(r.stderr, /bc stop \[--all\]/);
    assert.match(r.stderr, /bc agents/);
    // The agent CLI is not dumped on someone who typed `bc`.
    assert.doesNotMatch(r.stderr, /card create --title/);
    assert.match(r.stderr, /`bc-axi`, the agent CLI/);

    // A verb that needs a fleet refuses with the sentence that makes one.
    const agents = await runBc(['agents'], fleetEnv(home), home);
    assert.strictEqual(agents.code, 1);
    assert.match(agents.stderr, /no fleet found/);
    assert.match(agents.stderr, /`bc start` founds one there/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('bc start <dir> takes the fleet directory as a bare positional', async () => {
  const home = tmp('home');
  const fleet = path.join(home, 'named-fleet');
  fs.mkdirSync(fleet);
  try {
    const env = fleetEnv(home); // no BC_FLEET — the positional is the whole override
    const r = await retryOnPortClash(async () => {
      const port = await freePort();
      const out = await runBc(['start', fleet, '--port', String(port), '--harness', 'fake'], env);
      if (out.code !== 0 && /EADDRINUSE/.test(serverLog(fleet))) throw new Error('EADDRINUSE: boot lost the port');
      return out;
    });
    assert.strictEqual(r.code, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(fleet, '.bridge-commander', 'board.json')));
    assert.ok(r.stdout.includes(fs.realpathSync(fleet)), 'the roster names the fleet it founded');

    // A misspelled directory is a typo, not an invitation to create it.
    const typo = await runBc(['start', path.join(home, 'nope')], env);
    assert.strictEqual(typo.code, 1);
    assert.match(typo.stderr, /no such directory/);
  } finally {
    await runBc(['stop', '--workspace', fleet], fleetEnv(home));
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('bc start refuses to found a fleet inside a code project, and writes nothing', async () => {
  const home = tmp('home');
  const proj = path.join(home, 'some-repo');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'package.json'), '{}');
  try {
    const r = await runBc(['start', proj, '--harness', 'fake'], fleetEnv(home));
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /first run refused/);
    // The refusal is only worth anything if nothing was written before it — and
    // settling the tmux name writes config.json, which would itself make the
    // directory read as a workspace on the very next look.
    assert.ok(!fs.existsSync(path.join(proj, '.bridge-commander')), 'no state dir was left behind');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
