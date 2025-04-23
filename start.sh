#!/bin/bash
set -e

echo "Starting scraper process..."
npm run start &
SCRAPER_PID=$!

wait $SCRAPER_PID
exit $SCRAPER_PID