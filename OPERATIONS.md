# Operating the bridge-commander tool

On-demand reference for a lieutenant or agent running a live board server or shipping changes
to the tool itself. The doctrine governs how you orchestrate; this governs how you keep the
harness running under you. Read it when a restart, a deploy, or a wedged respawn is on your
plate — not before.

## Starting and stopping a board

`bc start` / `bc stop` are the ordinary door, and they are what a human should be told to run:
`bc start` founds the default fleet (`~/.config/bridge-commander`, or `bc start <dir>` /
`$BC_FLEET`) if there is none, brings the server up if it is down, and prints the URL together
with the agent roster. `bc stop` stops the board and NAMES the agent sessions it left running;
`bc stop --all` ends those too, server first so no supervision tick respawns what was just killed.

`bc` and `bc-axi` are one program behind two names — `bc` prints the captain verbs, `bc-axi` the
full agent reference. Neither is on anyone's PATH until `<checkout>/cli/bc-axi install` puts it
there: two symlinks into `~/.local/bin` (`--dir D` for elsewhere, `--uninstall` to take them back),
pointing at the checkout rather than copying it, so a `git pull` upgrades the commands. It edits no
rc file — a bin dir off the PATH is reported with the line that adds it. `install.sh` at the repo
root is the same thing for a machine with no checkout yet: clone (or fast-forward the clone it made
last time) into `~/.local/share/bridge-commander`, then hand off to that same `install`.

When you tell a person how to bring their board back up, tell them `bc start` — and if the command
is not found, `<checkout>/cli/bc-axi install` first.

## Is anything still running?

Lieutenants and workers are tmux sessions, not children of the server. They survive a restart on
purpose: the refs live on the board, so a fresh server picks the same sessions back up rather than
orphaning them (the boot sweep only closes worker windows whose card is off the board or out of
Working — see the restart section below).

`bc agents` is that fact made checkable — it probes every recorded ref through its harness and
prints `live`, `dead` or `none` per agent, with the tmux address to attach to. `bc-axi status
--agents` prints the same roster under the server line; `GET /api/agents?live=1` is the route
behind both (without `live=1` it lists the refs without paying for a probe per agent).

A `dead` lieutenant respawns on the next supervision tick. A `dead` worker does not — it is
`bc-axi card start <id> --resume` (same worktree, recorded resumeId) or `bc-axi card park <id>`.

Session names come from the fleet's `tmuxSession` stem: `<stem>-lt-<id>` for a lieutenant,
`w-<card-id>` for a worker's window inside it. A fleet founded by `bc start` is named
`bridge-commander`, so the addresses are guessable and `tmux attach -t bridge-commander-lt-<id>`
works without looking anything up. A fleet that predates this keeps its derived `bc-<disc>` stem —
that is the compatibility contract, since every session name already recorded in a board.json was
built on it — and `bc-axi config session <name>` renames the stem for sessions spawned FROM NOW
ON, never the ones already standing. The stem is claimed machine-wide in
`~/.bridge-commander/sessions.json`, so a second fleet asking for a name gets a suffixed one
instead of colliding inside tmux later.

## Reliable server restart

`bc-axi`'s ensureServer boots the server detached with stdio ignored, so it can fail silently —
a bare "it started" is not proof. Restart deliberately:

- Find the listening pid: `ss -ltnp | grep :<port>`.
- Kill it, then poll until the port actually frees (a relaunch onto a still-held port no-ops).
- Relaunch detached: `setsid nohup node server/server.js <workspace> --port <port> > <log> 2>&1 < /dev/null &`.
- Verify BOTH: `/api/status` returns 200 AND the listening pid changed. A stale duplicate can
  hold the port and fake a successful restart — same-pid means nothing restarted.
- Preserve any env-only config the operator set; a bare restart silently drops env vars.
- Restarting never kills the tmux session of a lieutenant, or of a worker on a Working card —
  they reattach to the fresh server. It DOES sweep the leftovers: a boot closes worker windows
  whose card is off the board or no longer in Working, which is the same death the handoff
  gives them.

## Deploying a merged PR to the tool

The board runs from a checkout on disk; a merged PR is not live until that checkout advances.

- Pull the checkout the server actually runs from (not your worktree).
- Restart the server only if `server/` or `harness/` changed.
- UI-only changes need just a browser refresh — no restart.

## Is the server running the code on disk?

The server reads its commit once, at boot, and never again — so after a merge it keeps serving
the old code while every call still succeeds. You do not have to remember: `bc-axi status`
prints `code=<short>` (`+dirty` when the tree was dirty at boot), and both `bc-axi status` and
the bare usage screen add one line the moment the checkout has moved past it, naming both
commits and the restart. Silence means the running server IS the code on disk. `code=unknown`
means git could not be read — not drift.

This is a report and never a gate: no operation is refused because of drift, and nothing
restarts the server for you.

## Updating the tool

Which update path applies depends on how the skill dir was installed — check for `.git`:

- **skills-CLI copy** (no `.git`): `npx skills add` copied the folder, so `git pull` won't work.
  Update = re-run `npx skills add tonylampada/bridge-commander -g`, then restart the server.
- **Dev checkout** (`.git` present): update via `git pull`, then follow the deploy section above.

Then re-run `bc-axi init --name <that lieutenant> --id <their id>` **in each workspace**: seeding
runs from `init` and nowhere else, so until it does, an upgraded workspace has neither the new
playbooks and hooks nor the `~/.claude/skills/bridge-commander-worker` symlink — and its
playbooks order a skill it does not have. Re-running is idempotent: it copies only the playbooks
and hooks that are missing, repoints only a symlink of ours (a hand-installed real directory is
left alone), and overwrites nothing you edited. It does PATCH the session ref of the lieutenant
whose id matches `--id` (or the slug of `--name`), so run it **from that lieutenant's own tmux
session** — from anywhere else you repoint them at the wrong address.

The `gh-watch` schedule is the one seed that runs ONCE per workspace, not once per `init`
(marker: `.bridge-commander/gh-watch.seeded`): an upgrade must never resurrect a schedule the
captain paused, repointed or removed. A workspace that predates the marker adopts its existing
`gh-watch` schedule instead, so the NEXT removal sticks.

## The stale-UI trap

After a UI deploy the board can LOOK live while running old JS: SSE reconnects and re-renders
current data, so the page feels fresh even though its code is stale. Data freshness ≠ code
freshness.

- When a shipped UI feature "doesn't work", first confirm the tab was reloaded post-deploy.
- Reproduce in a clean browser (or hard reload) before you touch code — most "bugs" here are
  just an un-reloaded tab.

## Orphan tmux session wedging a lieutenant respawn

Supervised respawn targets a fixed session name (`bc-<ws>-lt-<id>`). If an orphan already holds
that name, respawn fails "tmux session already exists", gives up after 3 tries, and never
retries on its own.

- Recover: `tmux kill-session -t <target>` to free the name.
- Then restart the server — that clears the in-memory retry counter so respawn runs again.

## Developing the tool — test notes

- Run the full suite from the repo root or a repo-ADJACENT worktree:
  `node --test test/*.test.js harness/test/*.test.js`.
- Never run it under `/tmp` — the ui/js ESM files fail to load there and tests go red for the
  wrong reason.
- The suite is load-independent — a red test is a real red test, and re-running it alone proves
  nothing. Two things keep it that way, and new tests have to keep both:
  - **Ports are reserved, not guessed.** `reservePort()` in `test/helper.js` keeps the socket
    bound so the kernel cannot hand the same number to another test file, releases it at the
    instant the server takes over, and `startServer` retries the boot on `EADDRINUSE`. A test
    that spawns its own binder (the CLI) wraps it in `retryOnPortClash()`. `freePort()` on its
    own hands back a number nobody is holding: fine as an input to a retrying boot, never as a
    promise that the port is still yours. A lost race has two faces and both are handled — the
    boot cannot bind (`EADDRINUSE`), or a stranger's board is already ANSWERING there, which
    `startServer` catches by checking `/api/status` reports its own child's pid.
  - **Real shells are polled, not slept at.** `harness/test/tmux-literal.test.js` waits for the
    prompt (or the typed text) to actually appear; a fixed `sleep` before reading a pane is a
    flake on any busy box.
- Genuine saturation is still saturation: a server gets 10s to answer `/api/status`, so a box
  with no idle core left at all can fail a boot on time alone. That is the machine, not the suite.
- `test/install/docker-install-test.sh` verifies the README install procedure end-to-end in a
  pristine Docker container; `--demo` also populates a demo board on port 4790 (the fixture
  behind the README screenshot) and keeps the container running.

## `bin/nm-clerk.sh` — the no-mistakes clerk

Not part of the server. It drives `no-mistakes axi` through its gates with no model in the
loop — fix the `auto-fix`, approve when only `no-op` remains, stop dead on `ask-user` — and it
ALWAYS exits 0, reporting through `$ARTIFACTS_DIR/nm-outcome` and `escalation.md`, because it
runs as a step inside a workflow loop where a non-zero exit kills the whole run. Callers reach
it by absolute path (`<this repo>/bin/nm-clerk.sh`), so the path is an interface: moving the
file breaks workflows that live outside this repo.

`--respond <fix|approve|skip> [--findings id,id]` is the second door: it answers the gate the
last invocation refused — the no-mistakes run is still open and still parked on it — and then
drives the rest to an outcome exactly as the first door does. That is what lets a human's
ruling arrive without anyone finishing the run by hand.

Its tests replay gate payloads recorded from real runs — `node --test test/nm-clerk.test.js`.
