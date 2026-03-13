# GitHub Secrets Setup Guide

This guide will help you set up the required GitHub secrets for the branch-specific workflows.

## Required Secrets

You need to create the following secrets in your GitHub repository:

### 1. `ACCOUNTS_JSON_MONDAY_STORAGE`
For the `monday-storage` branch workflow

### 2. `ACCOUNTS_JSON_INVOICES` 
For the `invoices` branch workflow

## ACCOUNTS_JSON Format

Each secret should contain a JSON array with account configurations. Here's the structure:

```json
[
  {
    "companyId": "hapoalim",
    "userCode": "AB1234",
    "password": "your-password"
  },
  {
    "companyId": "visaCal", 
    "username": "Your Username",
    "password": "your-password"
  },
  {
    "companyId": "leumi",
    "username": "Your Username", 
    "password": "your-password"
  }
]
```

## Supported Bank Companies

Based on the israeli-bank-scrapers library, here are the common `companyId` values:

- `hapoalim` - Bank Hapoalim
- `leumi` - Bank Leumi  
- `mizrahi` - Mizrahi Tefahot Bank
- `discount` - Israel Discount Bank
- `visaCal` - Visa Cal
- `max` - Max (formerly Leumi Card)
- `isracard` - Isracard
- `amex` - American Express Israel
- `otsarHahayal` - Otsar Ha-Hayal Bank
- `beinleumi` - Bank Beinleumi
- `masad` - Bank Massad
- `yahav` - Bank Yahav

## Account Field Requirements

Different banks require different fields:

### Bank Hapoalim (`hapoalim`)
```json
{
  "companyId": "hapoalim",
  "userCode": "your-user-code",
  "password": "your-password"
}
```

### Visa Cal (`visaCal`)
```json
{
  "companyId": "visaCal", 
  "username": "Your Full Name",
  "password": "your-password"
}
```

### Bank Leumi (`leumi`)
```json
{
  "companyId": "leumi",
  "username": "your-username",
  "password": "your-password"
}
```

## How to Set Up GitHub Secrets

1. Go to your GitHub repository
2. Click on **Settings** tab
3. In the left sidebar, click **Secrets and variables** → **Actions**
4. Click **New repository secret**
5. Enter the secret name (e.g., `ACCOUNTS_JSON_MONDAY_STORAGE`)
6. Enter the JSON configuration as the value
7. Click **Add secret**
8. Repeat for the other secret

## Example Configurations

### For Monday Storage Branch
```json
[
  {
    "companyId": "hapoalim",
    "userCode": "AB1234",
    "password": "password123"
  },
  {
    "companyId": "visaCal",
    "username": "John Doe", 
    "password": "password123"
  }
]
```

### For Invoices Branch
```json
[
  {
    "companyId": "leumi",
    "username": "jane.doe",
    "password": "password456"
  },
  {
    "companyId": "max",
    "username": "Jane Doe",
    "password": "password456"
  }
]
```

## Testing Your Configuration

After setting up the secrets, you can test the workflows by:

1. **Manual Trigger**: Go to Actions → Scrape - Monday Storage → Run workflow
2. **Push Trigger**: Push changes to the respective branches
3. **Scheduled**: Wait for the scheduled runs (10:05 and 22:05 UTC)

## Troubleshooting

- **Invalid JSON**: Make sure your JSON is valid (use a JSON validator)
- **Missing Fields**: Ensure all required fields are present for each bank
- **Wrong Company ID**: Use the exact company ID from the supported list
- **Authentication Issues**: Verify your credentials are correct

## Security Notes

- Never commit account credentials to the repository
- Use strong, unique passwords
- Consider using environment-specific credentials for different branches
- Regularly rotate your passwords
