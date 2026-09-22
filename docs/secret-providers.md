# Secret Providers

The Moneyman container can resolve its complete JSON/JSONC configuration from an external secret provider before Moneyman starts. It uses [Varlock](https://varlock.dev/) as the provider abstraction and currently includes direct support for Bitwarden Secrets Manager.

Existing `MONEYMAN_CONFIG` and `MONEYMAN_CONFIG_PATH` configurations remain supported. Provider resolution is enabled whenever `MONEYMAN_CONFIG_SECRET` is set.

The configuration source precedence is:

1. `MONEYMAN_CONFIG_SECRET`
2. `MONEYMAN_CONFIG`
3. `MONEYMAN_CONFIG_PATH`

## Bitwarden Secrets Manager

Store the complete contents of your Moneyman configuration as one Bitwarden secret. The resolved value is injected as `MONEYMAN_CONFIG` and then parsed and validated normally.

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

## GitHub Actions

Add one `MONEYMAN_CONFIG_SECRET` Actions repository secret containing the compact JSON descriptor shown above.

The scrape workflow forwards both the new and legacy secrets to the container. `MONEYMAN_CONFIG_SECRET` has higher precedence, so you can test the provider-backed path while retaining `MONEYMAN_CONFIG` as a rollback option. Remove the legacy secret after a successful provider-backed run.

At container startup:

1. The entrypoint detects `MONEYMAN_CONFIG_SECRET` and starts the provider adapter.
2. The adapter parses and validates the descriptor, then removes the descriptor and lower-precedence config variables from the child environment.
3. The adapter maps the descriptor to provider-specific bootstrap variables and runs Varlock.
4. Varlock retrieves the complete configuration and injects it as `MONEYMAN_CONFIG`.
5. Moneyman starts and parses and validates `MONEYMAN_CONFIG` through its existing configuration path.

After successful retrieval and validation, Moneyman writes `Configuration successfully loaded from Bitwarden Secrets Manager` to its normal log. With unsafe stdout disabled (the default), this message remains in the private log file.

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

Rotate the machine account token in Bitwarden and update only `MONEYMAN_CONFIG_SECRET` in the deployment platform. Updating the stored Moneyman configuration requires no image rebuild.

If provider authentication or secret retrieval fails, Varlock exits before Moneyman starts. With unsafe stdout disabled (the default), public logs receive only this fixed message:

```text
Moneyman failed before completion. Sensitive error details were withheld from public logs.
```

Detailed provider diagnostics remain in the private log file. Moneyman does not rely on every provider or resolver error being redacted before enforcing the public-log boundary.
