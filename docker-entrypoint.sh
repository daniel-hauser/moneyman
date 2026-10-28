#!/bin/sh
set -e

# Default command. Which mode to run is decided in the app (`dst/start.js`),
# which reads the same variable, so that a process started as the long running
# server behaves like one even when it was started directly.
if [ "$#" -eq 0 ]; then
  set -- node dst/start.js
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

  # Append, never truncate. A long lived process shares one file between runs
  # and empties it (`truncateSync`) between them, which only works when the
  # descriptor appends. A one shot process deletes the file when it is done,
  # so appending and truncating are the same thing for it.
  exec "$@" >> "$MONEYMAN_LOG_FILE_PATH" 2>&1
fi
