# Separated Mode

Moneyman now supports a separated mode where the scraping process (which has access to bank credentials) is isolated from the storage process (which has access to external storage services).

## Architecture

In separated mode:

1. **Scraper Service** (`scraper-service/index.ts`)
   - Runs with minimal privileges 
   - Only has access to bank scraping functionality
   - Sends results via ZeroMQ to storage service

2. **Storage Service** (`storage-service/index.ts`)
   - Receives data from scraper service
   - Handles all external storage operations (Google Sheets, YNAB, etc.)
   - Sends notifications via Telegram

3. **Communication**
   - ZeroMQ Push/Pull pattern for reliable message passing
   - JSON message format with typed interfaces

## Security Benefits

- **Reduced Attack Surface**: Scraper process doesn't need storage service dependencies
- **Process Isolation**: Different users for scraper vs storage (Docker user separation)
- **Network Restrictions**: Can apply iptables rules per user/process
- **Credential Separation**: Bank credentials only accessible to scraper process

## Usage

### Environment Variables

- `SEPARATED_MODE=true` - Enable separated mode
- `STORAGE_ENDPOINT` - ZeroMQ endpoint (default: tcp://127.0.0.1:5555)

### Docker

Use the new separated Dockerfile:

```bash
docker build -f Dockerfile.separated -t moneyman-separated .
docker run -e SEPARATED_MODE=true moneyman-separated
```

### Manual Testing

Terminal 1 (Storage):
```bash
npm run start:storage
```

Terminal 2 (Scraper):
```bash
npm run start:scraper
```

### Unified Mode (Default)

The original unified mode still works as before:

```bash
npm start
# or
docker build -t moneyman .
docker run moneyman
```

## Implementation Details

- **Minimal Changes**: Existing code largely unchanged
- **Backward Compatible**: Can still run in unified mode
- **ZeroMQ Messages**: Typed interfaces for communication
- **Graceful Shutdown**: Proper cleanup of ZeroMQ sockets
- **Error Handling**: Errors propagated from scraper to storage service