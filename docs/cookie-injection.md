# Cookie Injection

Some Israeli banks and credit card providers require OTP (one-time password) or 2FA verification on every login. Cookie injection lets you complete that verification once in a real browser, export the session cookies, and reuse them in subsequent automated runs so the scraper can skip the challenge.

## How it works

1. You log in manually using the **export-cookies** helper script.
2. The script prints the authenticated cookies as JSON.
3. You store that JSON in the `MONEYMAN_BROWSER_COOKIES` environment variable (or GitHub Actions secret).
4. On the next scrape run, moneyman injects the cookies into the browser context before the scraper navigates to the bank site.

## Exporting cookies

```bash
npm run export-cookies -- --company hapoalim --url https://www.bankhapoalim.co.il
```

A browser window opens. Log in, complete OTP/2FA, then press **Enter** in the terminal. The cookies are printed to stdout as JSON keyed by companyId:

```json
{ "hapoalim": [{ "name": "...", "value": "...", "domain": "..." }, ...] }
```

Run the script once per provider and merge the results:

```json
{
  "hapoalim": [...],
  "visaCal": [...]
}
```

## Setting up the secret

### GitHub Actions

Add a repository secret named `MONEYMAN_BROWSER_COOKIES` with the merged JSON object. The workflow already passes this variable to the Docker container.

### Local / Docker

Set the environment variable before running:

```bash
export MONEYMAN_BROWSER_COOKIES='{"hapoalim": [...]}'
npm start
```

Or with Docker:

```bash
docker run --rm \
  -e MONEYMAN_CONFIG \
  -e MONEYMAN_BROWSER_COOKIES \
  your-image
```

## JSON format

The JSON object is keyed by companyId. Only cookies matching the current companyId are injected for each scraper:

```json
{
  "hapoalim": [
    { "name": "session", "value": "abc", "domain": ".bankhapoalim.co.il" }
  ],
  "visaCal": [
    { "name": "token", "value": "xyz", "domain": ".cal-online.co.il" }
  ]
}
```

## Security considerations

- Browser cookies grant full access to your bank accounts. Treat `MONEYMAN_BROWSER_COOKIES` with the same care as passwords.
- Store it only in encrypted secret stores (e.g., GitHub Actions secrets, a password manager, or encrypted environment files).
- Cookies expire. You will need to re-export them periodically when sessions are invalidated.
- Never commit cookie values to version control.
