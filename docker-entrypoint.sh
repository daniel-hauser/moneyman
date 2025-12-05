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
  export MONEYMAN_LOG_FILE_PATH

  export MONEYMAN_PUBLIC_LOG_FD="${MONEYMAN_PUBLIC_LOG_FD:-3}"
  PUBLIC_LOG_FD="${MONEYMAN_PUBLIC_LOG_FD}"

  # Duplicate stdout to the public log FD so public logs bypass redirection
  eval "exec ${PUBLIC_LOG_FD}>&1"

  exec "$@" > "$MONEYMAN_LOG_FILE_PATH" 2>&1
fi
