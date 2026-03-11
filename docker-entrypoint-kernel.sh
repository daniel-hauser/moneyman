#!/bin/sh
set -e

if [ -z "$KERNEL_API_KEY" ]; then
  echo "ERROR: KERNEL_API_KEY is required for the kernel image."
  echo "Use the standard moneyman image for local browser support."
  exit 1
fi

exec docker-entrypoint.sh "$@"
