#!/bin/sh
set -e

# If unsafe stdout is disabled (false), redirect stdout and stderr to a log file
if [ "$MONEYMAN_UNSAFE_STDOUT" = "true" ]; then
  exec node dst/index.js
else
  if [ -z "$MONEYMAN_LOG_FILE_PATH" ]; then
    MONEYMAN_LOG_FILE_PATH="/tmp/moneyman.log"
    echo "Warning: MONEYMAN_LOG_FILE_PATH is not set. Using default: $MONEYMAN_LOG_FILE_PATH"
  fi
  exec node dst/index.js > "$MONEYMAN_LOG_FILE_PATH" 2>&1
fi
