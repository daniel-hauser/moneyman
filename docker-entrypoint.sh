#!/bin/sh
set -e

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

  PUBLIC_LOG_FD="${MONEYMAN_PUBLIC_LOG_FD:-3}"

  # Duplicate stdout to the public log FD so public logs bypass redirection
  eval "exec ${PUBLIC_LOG_FD}>&1"

  exec "$@" > "$MONEYMAN_LOG_FILE_PATH" 2>&1
fi
