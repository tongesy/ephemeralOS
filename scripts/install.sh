#!/bin/sh
# Install ephemeralOS on macOS or Linux:
#   curl -fsSL https://raw.githubusercontent.com/tongesy/ephemeralos/main/scripts/install.sh | sh
# Re-run it to update. Needs nothing but curl and tar: if Node 22.12+ isn't installed, a
# private copy is downloaded. Your keys, persona and memory in ~/.ephemeralos are untouched.
set -eu

REPO="${EOS_REPO:-tongesy/ephemeralos}"
REF="${EOS_REF:-main}"
DIR="${EOS_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/ephemeralos}"
BIN="${EOS_BIN_DIR:-$HOME/.local/bin}"
NODE_LINE="${EOS_NODE_LINE:-22}"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf 'ephemeralOS install: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null || fail "curl is needed."
command -v tar >/dev/null || fail "tar is needed."
mkdir -p "$DIR" "$BIN"

# --- Node ------------------------------------------------------------------------
node_ok() { # Node 22.12 or newer
  "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' 2>/dev/null
}

NODE=
if [ -x "$DIR/node/bin/node" ] && node_ok "$DIR/node/bin/node"; then
  NODE="$DIR/node/bin/node"
elif command -v node >/dev/null && node_ok "$(command -v node)" && command -v corepack >/dev/null; then
  NODE="$(command -v node)"
fi

if [ -z "$NODE" ]; then
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) fail "unsupported system $(uname -s); see the README for a manual install." ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) fail "unsupported processor $(uname -m)." ;;
  esac
  say "Downloading Node $NODE_LINE for $os-$arch"
  dist="https://nodejs.org/dist/latest-v$NODE_LINE.x"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL "$dist/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  file="$(grep -o "node-v[0-9.]*-$os-$arch\.tar\.gz" "$tmp/SHASUMS256.txt" | head -n 1)"
  [ -n "$file" ] || fail "no Node build for $os-$arch."
  curl -fsSL "$dist/$file" -o "$tmp/$file"
  if command -v sha256sum >/dev/null; then sum="$(sha256sum "$tmp/$file")"; else sum="$(shasum -a 256 "$tmp/$file")"; fi
  grep -q "^${sum%% *}  $file\$" "$tmp/SHASUMS256.txt" || fail "the Node download didn't match its checksum."
  rm -rf "$DIR/node" && mkdir -p "$DIR/node"
  tar -xzf "$tmp/$file" -C "$DIR/node" --strip-components=1
  NODE="$DIR/node/bin/node"
fi
NODE_BIN="$(dirname "$NODE")"
export PATH="$NODE_BIN:$PATH"

# --- ephemeralOS -------------------------------------------------------------------
say "Downloading ephemeralOS ($REF)"
tmp_app="$(mktemp -d)"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" | tar -xz -C "$tmp_app" --strip-components=1
rm -rf "$DIR/app" && mv "$tmp_app" "$DIR/app"

say "Installing dependencies and building"
cd "$DIR/app"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# A pnpm of the version the repo pins, for this script only: nothing global changes.
mkdir -p "$DIR/shims"
corepack enable --install-directory "$DIR/shims" pnpm
export PATH="$DIR/shims:$PATH"
pnpm install --frozen-lockfile
pnpm build

cat >"$BIN/ephemeralos" <<LAUNCHER
#!/bin/sh
exec "$NODE" "$DIR/app/packages/cli/bin/ephemeralos.mjs" "\$@"
LAUNCHER
chmod +x "$BIN/ephemeralos"

# --- Setup -------------------------------------------------------------------------
home="${EOS_HOME:-$HOME/.ephemeralos}"
if [ ! -f "$home/.env" ]; then
  if [ -r /dev/tty ]; then
    "$BIN/ephemeralos" init </dev/tty
  else
    echo "Run \`ephemeralos init\` to add your API keys."
  fi
fi

echo
say "ephemeralOS is installed."
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) echo "Add $BIN to your PATH, or run $BIN/ephemeralos." ;;
esac
echo "Start it with \`ephemeralos start\`, then open http://localhost:4317 in Chrome."
