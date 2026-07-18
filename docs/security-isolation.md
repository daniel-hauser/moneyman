# Security isolation

Moneyman separates the credential-bearing scraper from storage integrations and Telegram:

- `config-init` reads the legacy configuration without network access and writes separate read-only service configurations.
- `scraper` receives bank accounts and browser settings, but no storage credentials.
- `exporter` receives storage settings and strict scrape-result DTOs, but no bank credentials.
- `notifier` receives Telegram settings and owns OTP, screenshots, messages, and private combined-log delivery.
- Per-boundary egress proxies are the only containers attached to an external network.

Application containers run as non-root with a read-only filesystem, all Linux capabilities dropped, `no-new-privileges`, bounded process counts, and writable tmpfs only. Results and logs use authenticated HTTP over internal Docker networks; there are no shared result or log volumes.

Chromium uses `--no-sandbox` because its namespace sandbox cannot start under the supported Docker runtime. This retains the browser setting used by the previous image, while the surrounding non-root container, capability, filesystem, environment, and network boundaries substantially reduce its blast radius.

Service images use Node.js 24 LTS. Node 26 is intentionally excluded because Telegraf 4.16.3's multipart `sendDocument` requests stall under Node 26, while identical direct and proxied requests complete under Node 24.

## Egress policy

With `options.security.blockByDefault: true`, `ALLOW` rules become the scraper proxy allowlist. Parent entries cover subdomains, for example:

```text
max ALLOW max.co.il
```

Private, loopback, link-local, metadata, CGNAT, IPv4-mapped IPv6, NAT64, Teredo, 6to4, ULA, multicast, and documentation address ranges are rejected even if DNS resolves to them. Proxy traffic is limited to HTTP port 80 and HTTPS port 443.

## Logging

Secure mode is the production default:

```text
MONEYMAN_UNSAFE_STDOUT=false
MONEYMAN_LOG_DRIVER=none
```

Service logs remain in tmpfs and are sent privately through the notifier. GitHub Actions does not upload logs, screenshots, configurations, or transaction artifacts.
