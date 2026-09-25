#!/bin/sh
set -e

# Optionally install a specific @actual-app/api version at container start so a
# deployment can match its self-hosted Actual sync-server without rebuilding the
# image. The Actual API talks to the server over a versioned protocol (not plain
# HTTP), so a mismatch between this client and the server errors out.
#
#   MONEYMAN_ACTUAL_API_VERSION unset/empty -> use the version baked into the image
#   MONEYMAN_ACTUAL_API_VERSION=26.5.2      -> install that exact version
#   MONEYMAN_ACTUAL_API_VERSION=latest      -> install the newest published version
actual_version="${MONEYMAN_ACTUAL_API_VERSION:-}"

if [ -n "$actual_version" ]; then
  installed=""
  if [ "$actual_version" != "latest" ]; then
    # Read the on-disk version by file path (not as a package specifier) so an
    # "exports" map in the package cannot block the lookup.
    installed="$(node -p "require('./node_modules/@actual-app/api/package.json').version" 2>/dev/null || true)"
  fi

  if [ "$actual_version" = "$installed" ]; then
    echo "entrypoint: @actual-app/api@${actual_version} already installed; skipping install" >&2
  else
    echo "entrypoint: installing @actual-app/api@${actual_version}" >&2
    # Install scripts stay enabled so native deps (e.g. better-sqlite3) can fetch
    # their prebuilt binaries. Adding a single package does not trigger this
    # project's own prepare/postinstall, so the dev-only husky/patch-package
    # (pruned from the production image) are never invoked here.
    if ! npm install --no-save --no-audit --no-fund "@actual-app/api@${actual_version}"; then
      echo "entrypoint: failed to install @actual-app/api@${actual_version}" >&2
      exit 1
    fi
  fi
fi

# Default command
if [ "$#" -eq 0 ]; then
  set -- node dst/index.js
fi

if [ "$MONEYMAN_UNSAFE_STDOUT" = "true" ]; then
  exec "$@"
else
  if [ -z "$MONEYMAN_LOG_FILE_PATH" ]; then
    MONEYMAN_LOG_FILE_PATH="/tmp/moneyman.log"
  fi
  export MONEYMAN_LOG_FILE_PATH

  export MONEYMAN_PUBLIC_LOG_FD="${MONEYMAN_PUBLIC_LOG_FD:-3}"
  PUBLIC_LOG_FD="${MONEYMAN_PUBLIC_LOG_FD}"

  # Duplicate stdout to the public log FD so public logs bypass redirection
  eval "exec ${PUBLIC_LOG_FD}>&1"

  exec "$@" > "$MONEYMAN_LOG_FILE_PATH" 2>&1
fi
