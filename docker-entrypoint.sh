#!/bin/sh
set -e

# Default command
if [ "$#" -eq 0 ]; then
  if [ "$MONEYMAN_LONG_RUNNING" = "true" ]; then
    set -- node dst/server.js
  else
    set -- node dst/index.js
  fi
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

  if [ "$MONEYMAN_LONG_RUNNING" = "true" ]; then
    # Append, never truncate: the file is shared by every run of a long lived
    # process and is emptied (`truncateSync`) by the app between runs.
    exec "$@" >> "$MONEYMAN_LOG_FILE_PATH" 2>&1
  else
    exec "$@" > "$MONEYMAN_LOG_FILE_PATH" 2>&1
  fi
fi
