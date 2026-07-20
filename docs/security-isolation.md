# Security isolation

Moneyman separates the credential-bearing scraper from storage integrations and Telegram:

- `config-init` reads the legacy configuration without network access and writes separate read-only service configurations.
- `scraper` receives bank accounts and browser settings, but no storage credentials.
- `exporter` receives storage settings and strict scrape-result DTOs, but no bank credentials.
- `notifier` receives Telegram settings and owns OTP, screenshots, messages, and private combined-log delivery.
- Per-boundary egress proxies are the only containers attached to an external network.

Application containers run as non-root with a read-only filesystem, all Linux capabilities dropped, `no-new-privileges`, bounded process counts, and writable tmpfs only. Results and logs use authenticated HTTP over internal Docker networks; there are no shared result or log volumes.

Chromium uses `--no-sandbox` because its namespace sandbox cannot start under the supported Docker runtime. This retains the browser setting used by the previous image, while the surrounding non-root container, capability, filesystem, environment, and network boundaries substantially reduce its blast radius.

Service images use Node.js 25. Node 26 is intentionally excluded because Telegraf 4.16.3's multipart `sendDocument` requests stall under Node 26, while identical direct and proxied requests complete under Node 25.

## Egress policy

The `internal: true` Docker networks are the enforceable firewall boundary:
application containers have no route to the internet, even if compromised code
ignores the proxy environment variables or opens raw sockets. The egress
proxies provide hostname, port, DNS, and validated-address policy on the only
available path out; they are not the application containers' default gateway.

Do not add firewall administration capabilities to the application containers.
In-container iptables or nftables would require `CAP_NET_ADMIN`, allowing
compromised code to modify its own rules and weakening the current
`cap_drop: ALL` boundary. A host-managed `DOCKER-USER` or cloud firewall can be
added as defense in depth, but IP rules cannot replace the proxy's
hostname-aware policy for dynamic bank and storage endpoints.

With `options.security.blockByDefault: true`, `ALLOW` rules become the scraper proxy allowlist. Parent entries cover subdomains, for example:

```text
max ALLOW max.co.il
```

Legacy monolithic configuration keeps its existing `blockByDefault: false` default. New scraper-only configuration defaults to `true`; explicit rules are therefore required when adopting service-specific configuration. Public mode blocks private and reserved networks but permits arbitrary public HTTP(S) destinations, so it does not prevent credential exfiltration to an attacker-controlled public host. Use allowlist mode for the malicious-dependency threat model.

Private, loopback, link-local, metadata, CGNAT, IPv4-mapped IPv6, NAT64, Teredo, 6to4, ULA, multicast, and documentation address ranges are rejected even if DNS resolves to them. Scraper public mode remains limited to HTTP port 80 and HTTPS port 443. Exporter HTTP destinations preserve only the configured URL ports, Azure ingestion permits its service-assigned Blob and Queue hosts, and PostgreSQL URI connection strings use a dedicated allowlisted TCP forward to the configured database host and port.

## Logging

Secure mode is the production default:

```text
MONEYMAN_UNSAFE_STDOUT=false
MONEYMAN_LOG_DRIVER=none
```

Service logs remain in tmpfs and are sent privately through the notifier. GitHub Actions does not upload logs, screenshots, configurations, or transaction artifacts.
