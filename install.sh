#!/usr/bin/env sh
# install.sh — get `bc` onto a machine that has nothing yet.
#
#   curl -fsSL https://raw.githubusercontent.com/tonylampada/bridge-commander/main/install.sh | sh
#
# or, from a checkout you already have:
#
#   ./install.sh
#
# It does two things and says both: put the tool on disk (clone, or update the
# clone it made last time), and hand off to the tool's own `install`, which
# symlinks `bc` and `bc-axi` into ~/.local/bin. Nothing else is touched — no
# shell rc file is edited, no package manager is invoked, and a PATH that does
# not reach the bin dir is reported rather than fixed behind your back.
#
# Env:
#   BC_REPO_URL   the repository to clone (default: the published one)
#   BC_REF        branch or tag (default: main)
#   BC_CHECKOUT   where the checkout lives (default: ~/.local/share/bridge-commander)
#   BC_BIN_DIR    where the symlinks go   (default: ~/.local/bin, or $XDG_BIN_HOME)
set -eu

REPO_URL=${BC_REPO_URL:-https://github.com/tonylampada/bridge-commander.git}
REF=${BC_REF:-main}
CHECKOUT=${BC_CHECKOUT:-$HOME/.local/share/bridge-commander}

need() {
  command -v "$1" >/dev/null 2>&1 && return 0
  echo "bridge-commander needs $1, and it is not installed." >&2
  echo "  Debian/Ubuntu: sudo apt-get install -y $1" >&2
  echo "  macOS:         brew install $1" >&2
  return 1
}
# node and git are needed to install. tmux is needed to RUN an agent, and the
# first run says so itself with the exact command — so it is named here, not
# demanded: a machine can be perfectly worth installing onto before it has tmux.
need node || exit 1
need git || exit 1
command -v tmux >/dev/null 2>&1 || \
  echo "note: tmux is not installed yet — agents need it, and the first run will say so." >&2

# Already inside a checkout? Then that IS the tool, and cloning a second copy is
# how you end up updating the one you are not running.
HERE=""
case "${0:-}" in
  */*) [ -x "$(dirname "$0")/cli/bc-axi" ] && HERE=$(cd "$(dirname "$0")" && pwd) ;;
esac

if [ -n "$HERE" ]; then
  echo "using the checkout this script came from: $HERE"
  CHECKOUT=$HERE
elif [ -d "$CHECKOUT/.git" ]; then
  echo "updating $CHECKOUT ($REF)"
  git -C "$CHECKOUT" fetch --quiet origin "$REF"
  git -C "$CHECKOUT" checkout --quiet "$REF"
  git -C "$CHECKOUT" merge --quiet --ff-only "origin/$REF" || {
    echo "could not fast-forward $CHECKOUT to origin/$REF — it has local changes." >&2
    echo "Resolve them there, or point BC_CHECKOUT somewhere else." >&2
    exit 1
  }
else
  [ -e "$CHECKOUT" ] && { echo "$CHECKOUT exists and is not a git checkout — move it or set BC_CHECKOUT." >&2; exit 1; }
  echo "cloning $REPO_URL ($REF) into $CHECKOUT"
  mkdir -p "$(dirname "$CHECKOUT")"
  git clone --quiet --branch "$REF" "$REPO_URL" "$CHECKOUT"
fi

echo
if [ -n "${BC_BIN_DIR:-}" ]; then
  exec "$CHECKOUT/cli/bc-axi" install --dir "$BC_BIN_DIR"
fi
exec "$CHECKOUT/cli/bc-axi" install
