#!/bin/bash
set -e

echo "Starting moneyman with separated scraper and storage..."

# Configure basic iptables rules to demonstrate separation
# In production, these would be more comprehensive

# Allow internal communication on ZeroMQ port
iptables -A INPUT -p tcp --dport 5555 -s 127.0.0.1 -j ACCEPT || echo "iptables command failed, continuing..."

echo "Starting storage service..."
# Start storage service in background as storage user
su storage -c "cd /app && SEPARATED_MODE=true node dst/index.js" &
STORAGE_PID=$!

# Wait a moment for storage to start listening
sleep 3

echo "Starting scraper service..."
# Start scraper service as scraper user  
su scraper -c "cd /app && node dst/scraper-service/index.js" &
SCRAPER_PID=$!

# Wait for scraper to complete
wait $SCRAPER_PID
SCRAPER_EXIT_CODE=$?

echo "Scraper finished with exit code: $SCRAPER_EXIT_CODE"

# Give storage some time to finish processing
sleep 5

# Stop storage
kill $STORAGE_PID || true
wait $STORAGE_PID || true

echo "All processes completed"
exit $SCRAPER_EXIT_CODE