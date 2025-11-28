# Handling MFA in GitHub Actions

## The Problem

When running moneyman in GitHub Actions, you may encounter frequent MFA (Multi-Factor Authentication) requests from your bank. This happens because:

1. **Different IP addresses**: Each GitHub Actions run uses a different runner machine with a different IP address
2. **No session persistence**: By default, browser sessions don't persist between workflow runs
3. **Security measures**: Banks detect these changing IPs as suspicious activity and require additional verification

## Solutions

### 1. Use Long-Term Authentication Tokens (Recommended)

Some banks support long-term authentication tokens that bypass MFA. The `israeli-bank-scrapers` library supports these tokens for certain banks.

#### OneZero Accounts

For OneZero accounts, you can use the `otpLongTermToken` field to avoid MFA prompts:

```json
{
  "accounts": [
    {
      "companyId": "oneZero",
      "email": "your-email@example.com",
      "password": "your-password",
      "otpLongTermToken": "your-long-term-token-here"
    }
  ]
}
```

**How to get your `otpLongTermToken`:**

1. Run moneyman locally with your OneZero account configured
2. Enable debug logging: `DEBUG=moneyman:*`
3. During the first login, you'll receive an OTP code
4. After successful authentication, check the logs for the long-term token
5. Add this token to your account configuration in GitHub Secrets
6. Future runs will use this token instead of requesting OTP

**Note:** Without `otpLongTermToken`, you can still use OTP via Telegram (see solution #2).

#### Other Banks

Check the [israeli-bank-scrapers documentation](https://github.com/eshaham/israeli-bank-scrapers) for your specific bank to see if they support similar token-based authentication. Some banks may support:

- Session tokens
- Remember device tokens
- App-specific passwords

### 2. Enable OTP via Telegram

For accounts that require OTP but support interactive authentication, you can enable OTP requests via Telegram bot:

```json
{
  "options": {
    "notifications": {
      "telegram": {
        "apiKey": "your-telegram-bot-token",
        "chatId": "your-chat-id",
        "enableOtp": true,
        "otpTimeoutSeconds": 300
      }
    }
  }
}
```

When MFA is required during a GitHub Actions run, the bot will send you a message on Telegram requesting the OTP code. You'll need to respond within the timeout period (default: 300 seconds / 5 minutes).

**Setup:**

1. Create a Telegram bot using [@BotFather](https://t.me/botfather)
2. Get your chat ID by messaging [@userinfobot](https://t.me/userinfobot)
3. Add these credentials to your GitHub repository secrets
4. Enable OTP in your configuration as shown above

**Limitations:**

- Requires manual intervention during each run
- You must respond within the timeout period
- Not suitable for fully automated workflows
- Only supported for OneZero accounts currently

### 3. Cookie Persistence (Recommended for "Remember This Device")

Moneyman now supports persisting browser cookies between GitHub Actions runs. This allows banks to "remember" your device and avoid MFA prompts.

**How it works:**

1. After successful authentication, moneyman saves the browser cookies
2. On the next run, these cookies are restored before logging in
3. The bank recognizes the "device" and skips MFA

**Setup:**

1. Enable cookie persistence in your configuration:

```json
{
  "options": {
    "scraping": {
      "enableCookiePersistence": true
    }
  }
}
```

2. Run moneyman locally first to complete the initial authentication
3. Look for the output between `=== PERSISTED_COOKIES ===` markers in the logs
4. Copy the JSON output
5. Add it as a GitHub Secret named `PERSISTED_COOKIES`
6. Future GitHub Actions runs will automatically use these cookies

**Automatic Updates:**

Each successful scrape updates the cookies. To keep your cookies fresh:

1. Monitor the GitHub Actions logs for updated `PERSISTED_COOKIES` output
2. Periodically update the `PERSISTED_COOKIES` secret with the new value
3. This prevents cookie expiration (cookies typically expire after 7 days)

**Important Notes:**

- Cookies are stored encrypted in GitHub Secrets (secure)
- Cookie expiration varies by bank (usually 7-30 days)
- If MFA is requested again, cookies may have expired - update them
- This works with most banks that offer "Remember this device" option

### 4. Bank-Specific Solutions

#### App-Specific Passwords

Some banks allow you to create app-specific passwords or API tokens for automation:

1. Check your bank's online banking portal
2. Look for "Security Settings", "App Passwords", or "API Access"
3. Generate a dedicated password/token for moneyman
4. Use this instead of your regular password

### 5. Reduce Scraping Frequency

If MFA is unavoidable and requires manual intervention:

1. Reduce the frequency of the scrape workflow
2. Run it less often (e.g., weekly instead of daily)
3. Trigger it manually when needed using workflow_dispatch

Edit `.github/workflows/scrape.yml`:

```yaml
on:
  workflow_dispatch:  # Manual trigger only
  # schedule:
  #   - cron: "5 10 * * 0"  # Run only once a week
```

### 6. Use a Dedicated Server (Alternative to GitHub Actions)

For a more reliable setup without MFA issues:

1. Run moneyman on a dedicated server with a static IP
2. Use a VPS, home server, or always-on computer
3. Configure the bank to trust this IP address
4. Set up a cron job to run moneyman on schedule

This approach provides:
- Consistent IP address
- Persistent browser sessions
- Better support for "remember this device" features

## Configuration Examples

### Example 1: OneZero with Long-Term Token

```json
{
  "accounts": [
    {
      "companyId": "oneZero",
      "email": "user@example.com",
      "password": "secure-password",
      "otpLongTermToken": "long-term-token-from-first-login"
    }
  ],
  "storage": {
    "localJson": { "enabled": true }
  }
}
```

### Example 2: Multiple Banks with Telegram OTP

```json
{
  "accounts": [
    {
      "companyId": "oneZero",
      "email": "user@example.com",
      "password": "secure-password",
      "phoneNumber": "+972501234567"
    },
    {
      "companyId": "hapoalim",
      "userCode": "12345678",
      "password": "secure-password"
    }
  ],
  "storage": {
    "localJson": { "enabled": true }
  },
  "options": {
    "notifications": {
      "telegram": {
        "apiKey": "123456:ABC-DEF...",
        "chatId": "987654321",
        "enableOtp": true,
        "otpTimeoutSeconds": 300
      }
    }
  }
}
```

### Example 3: Cookie Persistence for All Banks

```json
{
  "accounts": [
    {
      "companyId": "hapoalim",
      "userCode": "12345678",
      "password": "secure-password"
    },
    {
      "companyId": "discount",
      "username": "user123",
      "password": "secure-password"
    }
  ],
  "storage": {
    "googleSheets": {
      "serviceAccountEmail": "service@account.com",
      "serviceAccountPrivateKey": "-----BEGIN PRIVATE KEY-----...",
      "sheetId": "your-sheet-id",
      "worksheetName": "_moneyman"
    }
  },
  "options": {
    "scraping": {
      "enableCookiePersistence": true
    }
  }
}
```

**Important:** After the first successful local run, copy the `PERSISTED_COOKIES` output from the logs and add it as a GitHub Secret. The workflow file already includes support for this secret.

### Example 4: Manual Trigger Only

```json
{
  "accounts": [
    {
      "companyId": "discount",
      "username": "user123",
      "password": "secure-password"
    }
  ],
  "storage": {
    "googleSheets": {
      "serviceAccountEmail": "service@account.com",
      "serviceAccountPrivateKey": "-----BEGIN PRIVATE KEY-----...",
      "sheetId": "your-sheet-id",
      "worksheetName": "_moneyman"
    }
  }
}
```

Then edit `.github/workflows/scrape.yml`:

```yaml
on:
  workflow_dispatch:  # Only manual triggers
```

## Security Considerations

### Storing Tokens

- **Always** store `otpLongTermToken` and other sensitive credentials in GitHub Secrets
- Never commit these values to your repository
- Rotate tokens periodically for security

### Token Expiration

Long-term tokens may expire after a certain period. If you start getting MFA requests again:

1. Clear the old token from your configuration
2. Run moneyman locally to get a new token
3. Update the token in your GitHub Secrets

### Access Control

- Limit who has access to your GitHub repository
- Review GitHub Actions logs regularly
- Use branch protection rules to prevent unauthorized workflow changes

## Troubleshooting

### Still Getting MFA Requests?

1. **Verify token is set correctly**: Check that `otpLongTermToken` is in your account configuration
2. **Check token validity**: The token may have expired; get a new one
3. **Review logs**: Look for authentication errors in GitHub Actions logs
4. **Bank changes**: Your bank may have changed their authentication requirements

### OTP Not Working?

1. **Check Telegram bot**: Ensure the bot is active and has permission to message you
2. **Verify credentials**: Double-check `apiKey` and `chatId` in your configuration
3. **Check timeout**: Increase `otpTimeoutSeconds` if you need more time to respond
4. **Enable OTP**: Ensure `enableOtp: true` is set in notifications.telegram

### Workflow Fails Silently?

1. **Enable debug logging**: Add `DEBUG: "moneyman:*"` to your workflow environment variables
2. **Check Telegram**: Error messages may be sent to Telegram if configured
3. **Review screenshots**: Failed logins may generate screenshots that are sent to Telegram

## Additional Resources

- [israeli-bank-scrapers documentation](https://github.com/eshaham/israeli-bank-scrapers)
- [GitHub Actions secrets documentation](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Moneyman Configuration Guide](./CONFIG_MIGRATION.md)

## Getting Help

If you're still experiencing issues:

1. Check existing [GitHub Issues](https://github.com/daniel-hauser/moneyman/issues)
2. Create a new issue with:
   - Your bank/company ID (without sensitive details)
   - Relevant error messages (redact sensitive information)
   - Your configuration structure (without passwords/tokens)
