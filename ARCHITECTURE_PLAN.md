# Architecture Plan: Separated Scraping and Storage Services

## Overview

This document outlines the architecture plan for separating the scraping process from the storage process in MoneyMan to enhance security by isolating sensitive bank credentials from external service access.

## Current Architecture

```
┌─────────────────────────────────────────┐
│         MoneyMan (Single Process)      │
├─────────────────────────────────────────┤
│ • Bank Credentials                      │
│ • Scraping Logic                        │
│ • Storage Services (Sheets, YNAB, etc) │
│ • External API Keys                     │
│ • Telegram Notifications               │
└─────────────────────────────────────────┘
```

**Security Issues:**
- Single process has access to both bank credentials AND external service API keys
- Large attack surface - compromise of any component exposes everything
- No isolation between sensitive operations

## Proposed Separated Architecture

```
┌─────────────────┐    ZeroMQ     ┌─────────────────┐
│ Scraper Service │◄──────────────┤ Storage Service │
├─────────────────┤    (Push/Pull) ├─────────────────┤
│ • Bank Creds    │                │ • API Keys      │
│ • Scraping Only │                │ • Storage Ops   │
│ • User: scraper │                │ • Notifications │
│ • UID: 1001     │                │ • User: storage │
└─────────────────┘                │ • UID: 1002     │
        │                          └─────────────────┘
        │                                    │
        ▼                                    ▼
┌─────────────────┐                ┌─────────────────┐
│   Bank Sites    │                │ External APIs   │
│                 │                │ • Google Sheets │
└─────────────────┘                │ • YNAB          │
                                   │ • Azure         │
                                   │ • Telegram      │
                                   └─────────────────┘
```

## Components

### 1. Scraper Service
**Purpose:** Minimal service that only handles bank scraping
**Location:** `scraper-service/index.ts`
**Responsibilities:**
- Execute bank account scraping using existing scraper logic
- Send results via ZeroMQ to storage service
- Handle scraping errors and send error messages
- Send status updates during scraping process
- Send metadata and failure screenshots

**Dependencies:**
- Minimal - only scraping-related packages
- ZeroMQ for communication
- Bank scraping libraries

**Security:**
- Runs as `scraper` user (UID 1001)
- Only has access to bank credentials
- No access to external service API keys
- Can be network-restricted to only bank domains

### 2. Storage Service
**Purpose:** Handles all external storage and notification operations
**Location:** `storage-service/index.ts`
**Responsibilities:**
- Receive scraping results from scraper service via ZeroMQ
- Save results to configured storage services (Google Sheets, YNAB, etc.)
- Send Telegram notifications
- Handle error notifications
- Process metadata and screenshots

**Dependencies:**
- All existing storage service dependencies
- ZeroMQ for communication
- External service API libraries

**Security:**
- Runs as `storage` user (UID 1002)
- Only has access to external service API keys
- No access to bank credentials
- Can be network-restricted from bank domains

### 3. Communication Layer
**Protocol:** ZeroMQ Push/Pull pattern
**Endpoint:** `tcp://127.0.0.1:5555` (configurable)
**Message Format:** JSON with typed interfaces

```typescript
interface ScraperMessage {
  type: 'results' | 'error' | 'status' | 'metadata' | 'screenshots' | 'finished';
  data: any;
}
```

**Message Types:**
- `results`: Account scraping results
- `error`: Error messages with stack traces
- `status`: Status updates during scraping
- `metadata`: Run metadata
- `screenshots`: Failure screenshots
- `finished`: Indicates scraping completion

## Implementation Strategy

### Phase 1: Core Infrastructure
1. Create `scraper-service/` directory with minimal scraper process
2. Create `storage-service/` directory with storage and notification logic
3. Implement ZeroMQ communication layer
4. Define typed message interfaces

### Phase 2: Service Separation
1. Extract scraping logic from main process to scraper service
2. Extract storage logic from main process to storage service
3. Implement message passing for all communication
4. Ensure graceful error handling across services

### Phase 3: Security Hardening
1. Create separate Docker users for each service
2. Implement separate Dockerfile for separated mode
3. Add network restrictions capability (iptables rules)
4. Document security configuration options

### Phase 4: Backward Compatibility
1. Maintain unified mode as default
2. Add `SEPARATED_MODE` environment variable
3. Ensure all existing functionality works in both modes
4. Add comprehensive testing for both modes

## File Structure

```
moneyman/
├── src/                           # Existing unified code
│   ├── scraper/                   # Scraping logic (used by scraper service)
│   ├── bot/storage/               # Storage logic (used by storage service)
│   └── ...
├── scraper-service/
│   └── index.ts                   # Minimal scraper process
├── storage-service/
│   └── index.ts                   # Storage and notification process
├── Dockerfile.separated           # Multi-stage build for separated mode
├── docker-entrypoint-separated.sh # Entry point for separated containers
└── package.json                   # Add ZeroMQ dependency
```

## Configuration

### Environment Variables
- `SEPARATED_MODE`: Enable separated mode (default: false)
- `STORAGE_ENDPOINT`: ZeroMQ endpoint (default: tcp://127.0.0.1:5555)

### Usage Modes

#### Unified Mode (Default - Backward Compatible)
```bash
npm start
# or
docker run moneyman
```

#### Separated Mode (Enhanced Security)
```bash
# Docker
docker build -f Dockerfile.separated -t moneyman-separated .
docker run -e SEPARATED_MODE=true moneyman-separated

# Manual (for development/testing)
npm run start:storage  # Terminal 1
npm run start:scraper  # Terminal 2
```

## Security Benefits

1. **Credential Isolation**: Bank passwords only accessible to scraper process
2. **Minimal Attack Surface**: Each service has minimal dependencies
3. **Process Separation**: Different users prevent cross-contamination
4. **Network Controls**: Can restrict scraper from external APIs and vice versa
5. **Principle of Least Privilege**: Each service only has access to what it needs

## Backward Compatibility

- Unified mode remains default behavior
- All existing functionality preserved
- No breaking changes to existing APIs
- Same Docker image can run both modes

## Testing Strategy

1. All existing tests must pass in unified mode
2. Add tests for ZeroMQ communication
3. Add integration tests for separated mode
4. Test error handling across service boundaries
5. Verify security isolation works as expected

## Dependencies

### New Dependencies
- `zeromq`: For inter-process communication

### Package.json Scripts
- `start:scraper`: Start scraper service
- `start:storage`: Start storage service
- `start:separated`: Start both services (development)

## Rollout Plan

1. Implement separated architecture with backward compatibility
2. Test thoroughly in both modes
3. Deploy with separated mode disabled by default
4. Gradually enable separated mode for security-conscious users
5. Consider making separated mode default in future major version

## Future Enhancements

1. **Container Orchestration**: Use Docker Compose for easier separated deployment
2. **Health Checks**: Add health monitoring for both services
3. **Metrics**: Add monitoring and metrics collection
4. **Configuration Management**: Centralized configuration service
5. **High Availability**: Multiple scraper instances with load balancing