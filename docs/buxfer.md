# Export to [Buxfer](https://www.buxfer.com/features)

To export your transactions directly to `Buxfer` you need to use the following configuration to setup:

```typescript
storage: {
  buxfer?: {
    /**
     * The `Buxfer` user name. Check [Buxfer settings](https://www.buxfer.com/settings?type=login) about how to obtain it
     */
    userName: string;
    /**
     * The `Buxfer` user password. Check [Buxfer settings](https://www.buxfer.com/settings?type=login) about how to obtain it
     */
    password: string;
    /**
     * A key-value list to correlate each account with the `Buxfer` account `UUID`
     */
    accounts: Record<string, string>;
  };
};
```

## accounts

A `JSON` key-value pair structure representing a mapping between two identifiers. The `key` represent the account ID as is understood by moneyman (as obtained from web scrapping the financial institutions) and the `value` it's the `UUID` visible in the Buxfer URL when an account is selected.

For example, in the URL:
`https://www.buxfer.com/account?id=123456` the account UUID is the account id query parameter.

Example:

```json
{
  "5897": "123456"
}
```
