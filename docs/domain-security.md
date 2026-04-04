# Domain Security

Given the nature of the scraping process, it's important to keep track of the domains accessed during the scraping process and ensure we connect only to the domains we expect.

## Domain Tracking

After enabling the domain tracking setting, the process will keep track of all domains accessed during the scraping process.
When the scraping process is done, a message will be sent to the telegram chat with the list of domains accessed.

## Domain Whitelisting

You can control which domains each scraper can access by configuring firewall rules. Each rule follows the format:

```
<companyId> <ALLOW|BLOCK> <domain>
```

Use the following configuration to setup:

```typescript
options: {
  security: {
    /**
     * A list of domain rules. Each line should follow the format `<companyId> <ALLOW|BLOCK> <domain>`
     */
    firewallSettings?: string[];
    /**
     * If truthy, all domains with no rule will be blocked by default. If falsy, all domains will be allowed by default
     */
    blockByDefault?: boolean;
  };
};
```

Example:

```typescript
options: {
  security: {
    firewallSettings: [
      "hapoalim ALLOW bankhapoalim.co.il",
      "visaCal BLOCK suspicious-domain.com",
    ];
  }
}
```

When a rule exists for a specific domain, the scraper will:

- `ALLOW` - Allow the connection to proceed
- `BLOCK` - Block the connection
- If no rule exists for a domain, the default behavior is to allow the connection

> [!IMPORTANT]
> All rules apply only if there is at least one rule for the scraper. scrapers with no rules will allow all connections

Rules support parent domain matching, so a rule for `example.com` will apply to `api.example.com` and `www.example.com` as well.
