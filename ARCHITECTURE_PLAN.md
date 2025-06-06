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

## Docker Implementation with User Separation

### Dockerfile Example with User Separation

```dockerfile
# Dockerfile.separated
FROM node:18-alpine AS base

# Create users with specific UIDs
RUN addgroup -g 1001 scraper && adduser -D -u 1001 -G scraper scraper
RUN addgroup -g 1002 storage && adduser -D -u 1002 -G storage storage

# Install dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --production

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Create directories with proper permissions
RUN mkdir -p /app/scraper-service /app/storage-service
RUN chown scraper:scraper /app/scraper-service
RUN chown storage:storage /app/storage-service

# Scraper service stage
FROM base AS scraper
USER scraper
WORKDIR /app
EXPOSE 5555
CMD ["node", "scraper-service/index.js"]

# Storage service stage  
FROM base AS storage
USER storage
WORKDIR /app
CMD ["node", "storage-service/index.js"]

# Combined stage for separated mode
FROM base AS separated
COPY docker-entrypoint-separated.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
```

### Network Security with iptables

#### Container Network Isolation Script

```bash
#!/bin/bash
# setup-container-security.sh

# Get container PIDs and network namespaces
SCRAPER_PID=$(docker inspect --format '{{.State.Pid}}' scraper-container)
STORAGE_PID=$(docker inspect --format '{{.State.Pid}}' storage-container)

# Enter scraper container network namespace and apply rules
nsenter -t $SCRAPER_PID -n iptables -A OUTPUT -m owner --uid-owner 1001 -j SCRAPER_RULES
nsenter -t $SCRAPER_PID -n iptables -N SCRAPER_RULES

# Allow scraper to access only banking domains
BANK_DOMAINS=(
    "otsar-hahayal.co.il"
    "bankhapoalim.co.il" 
    "mizrahi-tefahot.co.il"
    "bankleumi.co.il"
    "bankyahav.co.il"
    "discount.co.il"
    "fibi.co.il"
    "unionbank.co.il"
)

for domain in "${BANK_DOMAINS[@]}"; do
    # Resolve domain to IP (simplified - in production use DNS monitoring)
    IPS=$(dig +short "$domain" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$')
    for ip in $IPS; do
        nsenter -t $SCRAPER_PID -n iptables -A SCRAPER_RULES -d "$ip" -j ACCEPT
    done
done

# Allow localhost for ZeroMQ communication
nsenter -t $SCRAPER_PID -n iptables -A SCRAPER_RULES -d 127.0.0.1 -j ACCEPT

# Block all other outbound traffic for scraper
nsenter -t $SCRAPER_PID -n iptables -A SCRAPER_RULES -j DROP

# Enter storage container network namespace and apply rules  
nsenter -t $STORAGE_PID -n iptables -A OUTPUT -m owner --uid-owner 1002 -j STORAGE_RULES
nsenter -t $STORAGE_PID -n iptables -N STORAGE_RULES

# Allow storage to access external service domains
EXTERNAL_DOMAINS=(
    "sheets.googleapis.com"
    "api.youneedabudget.com" 
    "api.telegram.org"
    "management.azure.com"
    "*.blob.core.windows.net"
)

for domain in "${EXTERNAL_DOMAINS[@]}"; do
    # Handle wildcards and resolve IPs
    if [[ "$domain" == *"*"* ]]; then
        # For wildcards, allow the parent domain range (simplified)
        parent_domain="${domain#*.}"
        IPS=$(dig +short "$parent_domain" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$')
    else
        IPS=$(dig +short "$domain" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$')
    fi
    
    for ip in $IPS; do
        nsenter -t $STORAGE_PID -n iptables -A STORAGE_RULES -d "$ip" -j ACCEPT
    done
done

# Allow localhost for ZeroMQ communication
nsenter -t $STORAGE_PID -n iptables -A STORAGE_RULES -d 127.0.0.1 -j ACCEPT

# Block banking domains from storage service
for domain in "${BANK_DOMAINS[@]}"; do
    IPS=$(dig +short "$domain" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$')
    for ip in $IPS; do
        nsenter -t $STORAGE_PID -n iptables -A STORAGE_RULES -d "$ip" -j DROP
    done
done

# Allow other outbound traffic for storage (can be more restrictive)
nsenter -t $STORAGE_PID -n iptables -A STORAGE_RULES -j ACCEPT

echo "Network security rules applied successfully"
```

#### Domain Whitelist Configuration

```yaml
# security-config.yml
network_security:
  scraper_allowed_domains:
    # Israeli Banks
    - "otsar-hahayal.co.il"
    - "bankhapoalim.co.il"
    - "mizrahi-tefahot.co.il" 
    - "bankleumi.co.il"
    - "bankyahav.co.il"
    - "discount.co.il"
    - "fibi.co.il"
    - "unionbank.co.il"
    # Credit Cards
    - "cal-online.co.il"
    - "max.co.il"
    - "isracard.co.il"
    # Infrastructure
    - "127.0.0.1"  # ZeroMQ communication
    
  storage_allowed_domains:
    # External Services
    - "sheets.googleapis.com"
    - "www.googleapis.com"
    - "api.youneedabudget.com"
    - "api.telegram.org"
    - "management.azure.com"
    - "*.blob.core.windows.net"
    - "login.microsoftonline.com"
    # Infrastructure  
    - "127.0.0.1"  # ZeroMQ communication
    
  storage_blocked_domains:
    # Block banking domains from storage
    - "*.co.il"  # Block all Israeli domains as precaution
    - "otsar-hahayal.co.il"
    - "bankhapoalim.co.il"
    - "mizrahi-tefahot.co.il"
    - "bankleumi.co.il"
```

## Build and Test Scripts for Separated Mode

### Build Scripts

#### Master Build Script
```bash
#!/bin/bash
# scripts/build.sh

set -e

echo "🏗️  Building MoneyMan with separated architecture..."

# Build TypeScript
echo "Compiling TypeScript..."
npm run build

# Build unified Docker image (backward compatibility)
echo "Building unified Docker image..."
docker build -t moneyman:latest .

# Build separated Docker image
echo "Building separated Docker image..."
docker build -f Dockerfile.separated -t moneyman:separated .

# Build individual service images
echo "Building scraper service image..."
docker build -f Dockerfile.separated --target scraper -t moneyman:scraper .

echo "Building storage service image..."
docker build -f Dockerfile.separated --target storage -t moneyman:storage .

echo "✅ Build completed successfully!"
```

#### Development Build Script  
```bash
#!/bin/bash
# scripts/build-dev.sh

set -e

echo "🔧 Building for development..."

# Install dependencies
npm install

# Build TypeScript with watch mode in background
echo "Starting TypeScript compilation in watch mode..."
npm run build:watch &
BUILD_PID=$!

# Function to cleanup on exit
cleanup() {
    echo "Stopping build process..."
    kill $BUILD_PID 2>/dev/null || true
}
trap cleanup EXIT

echo "✅ Development build started. Press Ctrl+C to stop."
wait $BUILD_PID
```

### Test Scripts

#### Comprehensive Test Script
```bash
#!/bin/bash
# scripts/test.sh

set -e

TEST_MODE=${1:-"all"}

echo "🧪 Running MoneyMan tests..."

run_unit_tests() {
    echo "Running unit tests..."
    npm test
}

run_integration_tests() {
    echo "Running integration tests..."
    npm run test:integration
}

run_separated_mode_tests() {
    echo "🔀 Testing separated mode..."
    
    # Start ZeroMQ in test mode
    echo "Starting test ZeroMQ broker..."
    docker run -d --name zeromq-test -p 5556:5555 redis:alpine redis-server --port 5555 &
    ZEROMQ_PID=$!
    
    # Test scraper service in isolation
    echo "Testing scraper service..."
    SEPARATED_MODE=true STORAGE_ENDPOINT=tcp://127.0.0.1:5556 npm run test:scraper
    
    # Test storage service in isolation  
    echo "Testing storage service..."
    SEPARATED_MODE=true STORAGE_ENDPOINT=tcp://127.0.0.1:5556 npm run test:storage
    
    # Test end-to-end communication
    echo "Testing service communication..."
    npm run test:e2e:separated
    
    # Cleanup
    docker stop zeromq-test 2>/dev/null || true
    docker rm zeromq-test 2>/dev/null || true
}

run_security_tests() {
    echo "🔒 Running security tests..."
    
    # Test user separation
    echo "Testing Docker user separation..."
    docker run --rm moneyman:scraper id
    docker run --rm moneyman:storage id
    
    # Test network isolation (requires privileged mode)
    if [[ "$EUID" -eq 0 ]]; then
        echo "Testing network isolation..."
        ./scripts/test-network-isolation.sh
    else
        echo "⚠️  Skipping network isolation tests (requires root)"
    fi
    
    # Test credential isolation
    echo "Testing credential isolation..."
    npm run test:security:credentials
}

run_docker_tests() {
    echo "🐳 Testing Docker configurations..."
    
    # Test unified mode
    echo "Testing unified Docker mode..."
    docker run --rm -e NODE_ENV=test moneyman:latest npm test
    
    # Test separated mode
    echo "Testing separated Docker mode..."
    docker-compose -f docker-compose.test.yml up --abort-on-container-exit
    docker-compose -f docker-compose.test.yml down
}

# Main execution
case $TEST_MODE in
    "unit")
        run_unit_tests
        ;;
    "integration")  
        run_integration_tests
        ;;
    "separated")
        run_separated_mode_tests
        ;;
    "security")
        run_security_tests
        ;;
    "docker")
        run_docker_tests
        ;;
    "all")
        run_unit_tests
        run_integration_tests
        run_separated_mode_tests
        run_security_tests
        run_docker_tests
        ;;
    *)
        echo "Usage: $0 [unit|integration|separated|security|docker|all]"
        exit 1
        ;;
esac

echo "✅ All tests completed successfully!"
```

#### Quick Development Test Script
```bash
#!/bin/bash  
# scripts/test-dev.sh

set -e

echo "🚀 Quick development tests..."

# Run linting
echo "Linting code..."
npm run lint

# Run unit tests only
echo "Running unit tests..."
npm run test:unit

# Test TypeScript compilation
echo "Testing TypeScript compilation..."
npm run build

# Test separated mode locally (without Docker)
echo "Testing separated mode locally..."
SEPARATED_MODE=true npm run test:local:separated

echo "✅ Development tests passed!"
```

### Docker Compose for Easy Testing

```yaml
# docker-compose.test.yml
version: '3.8'

services:
  scraper-test:
    build:
      context: .
      dockerfile: Dockerfile.separated
      target: scraper
    environment:
      - NODE_ENV=test
      - SEPARATED_MODE=true
      - STORAGE_ENDPOINT=tcp://storage-test:5555
    depends_on:
      - storage-test
    volumes:
      - ./test-data:/app/test-data:ro
    networks:
      - test-network

  storage-test:
    build:
      context: .
      dockerfile: Dockerfile.separated  
      target: storage
    environment:
      - NODE_ENV=test
      - SEPARATED_MODE=true
      - STORAGE_ENDPOINT=tcp://0.0.0.0:5555
    ports:
      - "5555:5555"
    networks:
      - test-network
      
networks:
  test-network:
    driver: bridge
```

### Package.json Scripts Addition

```json
{
  "scripts": {
    "build": "tsc",
    "build:watch": "tsc --watch",
    "build:docker": "./scripts/build.sh",
    "build:dev": "./scripts/build-dev.sh",
    
    "test": "jest",
    "test:unit": "jest --testPathPattern=unit",
    "test:integration": "jest --testPathPattern=integration", 
    "test:scraper": "jest --testPathPattern=scraper",
    "test:storage": "jest --testPathPattern=storage",
    "test:e2e:separated": "jest --testPathPattern=e2e/separated",
    "test:security:credentials": "jest --testPathPattern=security/credentials",
    "test:local:separated": "concurrently \"npm run start:storage\" \"npm run start:scraper\"",
    "test:dev": "./scripts/test-dev.sh",
    "test:all": "./scripts/test.sh all",
    "test:separated": "./scripts/test.sh separated",
    "test:security": "./scripts/test.sh security",
    
    "start:scraper": "node scraper-service/index.js",
    "start:storage": "node storage-service/index.js", 
    "start:separated": "concurrently \"npm run start:storage\" \"npm run start:scraper\"",
    "start:dev:separated": "concurrently \"npm run start:storage\" \"npm run start:scraper\" --kill-others-on-fail"
  }
}
```

## Future Enhancements

1. **Container Orchestration**: Use Docker Compose for easier separated deployment
2. **Health Checks**: Add health monitoring for both services
3. **Metrics**: Add monitoring and metrics collection
4. **Configuration Management**: Centralized configuration service
5. **High Availability**: Multiple scraper instances with load balancing