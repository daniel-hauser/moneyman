# Secret Providers

Moneyman can load its complete JSON/JSONC configuration from an external secret provider at startup and refresh it before each scrape in long-running mode. This works in Docker, with `npm start`, and with configuration verification scripts. Provider support uses [Varlock](https://varlock.dev/) and currently includes Bitwarden Secrets Manager.

Existing `MONEYMAN_CONFIG` and `MONEYMAN_CONFIG_PATH` configurations remain supported. Supply the provider descriptor using either `MONEYMAN_CONFIG_SECRET` or `MONEYMAN_CONFIG_SECRET_FILE`, not both.

The configuration source precedence is:

1. `MONEYMAN_CONFIG_SECRET` or `MONEYMAN_CONFIG_SECRET_FILE` (mutually exclusive)
2. `MONEYMAN_CONFIG`
3. `MONEYMAN_CONFIG_PATH`

## Bitwarden Secrets Manager

Store the complete contents of your Moneyman configuration as one Bitwarden secret. Moneyman retrieves and validates the configuration before initializing logging, Telegram, and scheduling.

1. In Bitwarden Secrets Manager, create a project and a secret containing the complete configuration.
2. Create a machine account with read-only access to that project or secret.
3. Copy the secret UUID and the machine account access token.
4. Store a JSON descriptor containing both values in `MONEYMAN_CONFIG_SECRET`:

```bash
docker run --rm \
  -e MONEYMAN_CONFIG_SECRET \
  ghcr.io/daniel-hauser/moneyman:latest
```

Set `MONEYMAN_CONFIG_SECRET` in the shell or your container platform's secret store rather than placing it in shell history. Its value has this shape:

```json
{
  "provider": "bitwarden",
  "secretId": "00000000-0000-4000-8000-000000000000",
  "accessToken": "<machine-account-access-token>"
}
```

The machine account needs only read access to the selected secret. For Docker Compose, place the compact JSON descriptor in the existing `.env` file used by `docker-compose.yml`:

```dotenv
MONEYMAN_CONFIG_SECRET={"provider":"bitwarden","secretId":"00000000-0000-4000-8000-000000000000","accessToken":"<machine-account-access-token>"}
```

### Docker Compose Secrets

Alternatively, save the same JSON descriptor in a host file such as `./secrets/moneyman_provider.json`, restrict its permissions to the required deployment user, and keep it out of version control. Mount it as a Compose secret:

```yaml
services:
  moneyman:
    image: ghcr.io/daniel-hauser/moneyman:latest
    environment:
      MONEYMAN_CONFIG_SECRET_FILE: /run/secrets/moneyman_provider
      MONEYMAN_LONG_RUNNING: "true"
    secrets:
      - moneyman_provider

secrets:
  moneyman_provider:
    file: ./secrets/moneyman_provider.json
```

Remove `MONEYMAN_CONFIG_SECRET` from the service environment, including any `env_file`. Setting both descriptor variables is an error, even if one is empty. A configured file path must refer to a readable, non-empty file containing a valid provider descriptor; missing, unreadable, empty or malformed files stop startup without falling back to inline configuration or another configuration file.

Moneyman reads the descriptor directly from the mounted file without copying it into `process.env.MONEYMAN_CONFIG_SECRET`. Only the file path appears in the container's configuration environment. Standalone Compose secrets are protected file mounts, **not encrypted Swarm secret storage**. Protect the host file and its backups; root and Docker access remain privileged and can access mounted secrets. The existing provider loader still passes credentials through a transient child-process environment internally.

The descriptor is read once at startup. After rotating the descriptor file or its machine account token, restart the container (recreate it if needed to mount a replaced host file). Provider configuration refreshes do not reread the descriptor file.

## GitHub Actions

Add one `MONEYMAN_CONFIG_SECRET` Actions repository secret containing the compact JSON descriptor shown above.

The scrape workflow forwards both the new and legacy secrets to the container. `MONEYMAN_CONFIG_SECRET` has higher precedence, so you can test the provider-backed path while retaining `MONEYMAN_CONFIG` as a rollback option. Remove the legacy secret after a successful provider-backed run.

After successful retrieval and validation, Moneyman writes `Configuration successfully loaded from secret provider` to its normal log. With unsafe stdout disabled (the default), this message remains in the private log file.

The GitHub workflow does not parse the descriptor or contact Bitwarden itself; those steps happen inside the container at runtime.

## Self-Hosted Bitwarden

The included schema uses Bitwarden's default cloud API and identity endpoints. For a self-hosted installation, set static `apiUrl` and `identityUrl` arguments on `@initBitwarden` in `.env.schema`, as described in the [Varlock Bitwarden documentation](https://varlock.dev/plugins/bitwarden/#self-hosted-bitwarden).

## Other Providers

Varlock supports additional providers such as Azure Key Vault, AWS Secrets Manager, Google Secret Manager, HashiCorp Vault/OpenBao, 1Password, and Infisical. To add one:

1. Install its Varlock plugin as a production dependency.
2. Register and initialize it in `.env.schema`.
3. Replace the `MONEYMAN_CONFIG` resolver with the provider's resolver function.
4. Add a descriptor variant that maps that provider's fields to its internal bootstrap environment.

Keep the provider secret as one complete configuration document. This preserves Moneyman's existing parsing, validation, and `MONEYMAN_CONFIG` precedence behavior.

## Rotation and Failure Behavior

Rotate the machine account token in Bitwarden and update `MONEYMAN_CONFIG_SECRET` in the deployment platform or the descriptor file selected by `MONEYMAN_CONFIG_SECRET_FILE`. Updating the stored Moneyman configuration requires no image rebuild.

In [long-running mode](../README.md#long-running-mode), Moneyman retrieves and validates the provider configuration before every scheduled or manually triggered scrape. Fresh bank credentials, storage credentials, and per-run scraping and security settings apply to that run. Logging, Telegram notification settings, and the schedule remain unchanged until the container restarts.

One-shot runs use the startup configuration without fetching it a second time. Custom container commands that run Moneyman or its configuration verifier use the same configuration sources; unrelated commands do not retrieve or receive provider secrets.

When a provider is configured, `/refresh_secrets` is available in the configured Telegram chat to refresh the provider configuration without starting a scrape. Manual refreshes can run alongside scraping or other refreshes without changing an active scrape's configuration. Duplicate scrape requests are still rejected. The next scrape still performs its own automatic refresh.

Provider retrieval is limited to 60 seconds, both at startup and during refresh. If a refresh fails, that scrape does not start with stale credentials or fall back to another configuration source. The bot remains available so you can correct the provider configuration and try again. Refreshing applies only to provider-backed configuration; direct `MONEYMAN_CONFIG` and `MONEYMAN_CONFIG_PATH` configurations retain their startup behavior.

Restart the container after changing the descriptor or machine account token in the deployment environment or mounted file.

If the descriptor, provider access, or retrieved configuration is invalid at startup, Moneyman stops without falling back to `MONEYMAN_CONFIG` or `MONEYMAN_CONFIG_PATH`. With unsafe stdout disabled (the default), public logs receive only this fixed message:

```text
Moneyman failed before completion. Sensitive error details were withheld from public logs.
```

Detailed provider diagnostics remain in the private log file. Moneyman does not rely on every provider or resolver error being redacted before enforcing the public-log boundary.
