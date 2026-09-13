# Bridge Commander

<p align="center">
  <a href="https://youtu.be/lewm5_2LiNs">
    <img src="https://github.com/user-attachments/assets/048b00c1-bae8-4a49-aa7c-4ae8f0d8656c" width="420" alt="Watch the video">
  </a>
</p>

As you work with AI, your **attention gets fragmented** — driving multiple planning tasks while
overseeing multiple implementation tasks. Chat quickly becomes the wrong UX for piloting a fleet
of agents.

This skill lets you use Claude Code / Codex as multiple chiefs of staff (**lieutenants**). You
get a web UI where you work together, as work items get done by independent agent sessions on a
kanban board.

![the board](docs/img/board.png)

## Install

One line:

```sh
curl -fsSL https://raw.githubusercontent.com/tonylampada/bridge-commander/main/install.sh | sh
```

That clones into `~/.local/share/bridge-commander` and puts **`bc`** — the whole CLI — in
`~/.local/bin`. Already have a checkout (the skill folder counts)? Install from it instead, no
second copy:

```sh
<checkout>/cli/bc install          # --dir D for another bin dir, --uninstall to take it back
```

`bc` is a symlink into the checkout, so updating the checkout updates the command. Nothing is
copied and no shell rc file is edited: a bin directory that isn't on your `PATH` is reported with
the one line that adds it.

You also need `tmux` and `git` on the machine — `bc` says so if they're missing.

**Driving it from Claude Code instead?** The board is also a skill, so an agent can run the whole
setup for you:

```sh
npx skills add tonylampada/bridge-commander -g -y
```

Then `/bridge-commander` in any `claude` session.

## Start

```sh
bc start
```

One command, from any directory. It founds your fleet if you don't have one, brings the board up
if it's down, and prints the URL (default `http://localhost:4780/`) together with who is running.

**Bridget** is already on that board with a message waiting. She's your first lieutenant, and she
does the rest of the setup with you — tools, projects, the checklist. You never have to touch
tmux yourself, though you can.

## Every day after that

```sh
bc start      # bring the board up, print the URL + who is running
bc agents     # every lieutenant and worker, its tmux address, and whether that pane is live
bc stop       # stop the board — agent sessions keep running
bc stop --all # …and end those too
bc help       # the full reference: cards, lieutenants, playbooks, schedules, hooks
```

**Where the fleet lives.** With no argument, `bc start` uses — and founds, if it isn't there yet —
the default fleet at `~/.config/bridge-commander` (`$XDG_CONFIG_HOME` is honoured). Override it per
call with `bc start ~/dev/myfleet`, or for a whole shell with `BC_FLEET=~/dev/myfleet`. Run from
inside an existing workspace, `bc` uses *that* workspace.

**Where the agents live.** Lieutenants and workers are tmux sessions, not children of the board:
they survive `bc stop`, a crash, and a restart of the server process, and a fresh server adopts
them back off the refs recorded on the board. A founded fleet names them after a stem you can type
— `bridge-commander` by default, so Bridget is at `bridge-commander-lt-bridget` and
`tmux attach -t bridge-commander-lt-bridget` just works. Pick another with
`bc start --session <name>` or `bc config session <name>`. Two fleets can't collide on one name:
the second to ask gets a suffixed one and is told.

`bc agents` is the answer to "is anything still running?" — it probes every recorded session and
prints `live`, `dead` or `none` per agent. A dead worker is resumed with
`bc card start <id> --resume`, or shelved with `bc card park <id>`.

## Configuration

Per-workspace config lives in `.bridge-commander/config.json`:

| Key | Default | Meaning |
|---|---|---|
| `port` | `4780` | server port (also `--port N` on `bc start`) |
| `host` | `127.0.0.1` | bind address — see network exposure below |
| `harness` | `claude` | default agent harness (`claude` \| `codex`) |
| `tmuxSession` | `bridge-commander` on a fleet founded by `bc start`; a derived `bc-<disc>` stem otherwise | the stem every spawned session is named after — a lieutenant lives at `<stem>-lt-<id>`, its workers in windows inside that session. Set it with `bc start --session N` / `bc config session N`. Changing it never renames a session that already exists: lieutenants already living in one keep it, and the new name applies to the next one spawned |
| `voices` | — | UI text-to-speech voice filter |
| `tts` | — | speak agent messages through an external TTS engine: `{"url": "http://127.0.0.1:8883", "lang": "pt", "voice": null, "params": {}}` (voxbench API). Absent = the board stays silent. The **server** reaches the engine: the browser talks to `/api/tts/*` on the board's own origin and the url only has to be reachable from the machine running the server (no CORS, no tailnet on the phone) |

Env knobs (set on the server process):

| Variable | Default | Meaning |
|---|---|---|
| `BC_SUPERVISE_INTERVAL_MS` | `30000` | supervision tick (lieutenant respawn, dead-worker detection); `0` disables |
| `BC_PRWATCH_INTERVAL_MS` | `120000` | PR watch tick; `0` disables |
| `BC_UPLOAD_MAX_BYTES` | `10485760` | per-file chat upload cap |
| `BC_WORKER_TTL_SECS` | `600` | card status lease TTL — `working`/`needs-you` decays to `idle` past it |
| `BC_WORKTREE_TOOL` | auto | `treehouse` \| `git` — worker worktree provisioning |
| `BC_HARNESS_STATE` | `~/.bridge-commander/harness` | harness state dir (prompts, session ids, turn-end logs) |
| `BC_FLEET` | — | the fleet every `bc` call acts on, overriding both the default fleet and upward discovery from cwd |
| `BC_TMUX_SESSION` | — | one-off override of the tmux stem, ahead of `config.json` |
| `BC_HOME_STATE` | `~/.bridge-commander` | home state dir — holds the machine-wide tmux-name registry (`sessions.json`) that keeps two fleets off one stem |
| `BC_GH_CMD` | `gh` | gh binary used by the PR watch and by the packaged `gh-watch` hook |
| `BC_SCHEDULE_INTERVAL_MS` | `15000` | schedule tick — how often the clock looks for due windows; `0` disables |
| `BC_TURNEND_URL` | — | default callback URL baked into installed turn-end hooks |
| `BC_SEND_RETRIES` / `BC_SEND_SLEEP_MS` | `3` / `400` | verified-submit tuning for `harness.send` |
| `BC_HOOK_TIMEOUT_MS` | `120000` | per-script timeout for workspace hooks, lifecycle and named alike |
| `BC_TEARDOWN_TIMEOUT_MS` | `300000` / `60000` | timeout for a playbook's `teardown` command — 5 min at the handoff and archive (un-awaited), 60s at a rework restart (awaited inside `card start`); set, it overrides both |
| `BC_TTS_IDLE_MS` | `20000` | how long the TTS passthrough waits for the next byte from the engine before hanging up — a gap between bytes, not a cap on the request |
| `BC_SYSLOAD_MS` | `2000` | monitoring panel (⚙️ → machine load) sample interval; the sampler runs only while the panel is open |

### Network exposure

The board has **no application-level auth** — whoever reaches the bind address fully controls
the board, including starting workers (running code):

- **Default (recommended): loopback only** (`127.0.0.1`).
- Private mesh (e.g. Tailscale): set `host` to that interface's address (`bc start --host H`); a loopback listener is
  kept alongside. The mesh is your only auth boundary.
- **Never bind `0.0.0.0`.**

How it works inside: [ARCHITECTURE.md](ARCHITECTURE.md). The conceptual API
([docs/api/overview.md](docs/api/overview.md)) is the spec the implementation follows.
