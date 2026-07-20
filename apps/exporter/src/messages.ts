import { escapers } from "@telegraf/entity";
import {
  TransactionStatuses,
  TransactionTypes,
  type Transaction,
} from "@moneyman/protocol";
import type { Timer } from "@moneyman/common";

export function saving(storage: string, steps: Timer[] = []) {
  const stepsString = steps.map((step) => `\t${step}`).join("\n");
  return `📝 ${storage} Saving...\n${stepsString}`.trim();
}

export function transactionList(transactions: Transaction[], indent = "\t") {
  return escapers.HTML(
    transactions
      .map((transaction) => {
        const amount = transactionAmount(transaction);
        const sign = amount < 0 ? "-" : "+";
        const currency =
          transaction.originalCurrency === "ILS"
            ? ""
            : ` ${transaction.originalCurrency}`;
        return `${indent}${transaction.description}:\t${sign}${Math.abs(amount).toFixed(2)}${currency}`;
      })
      .join("\n"),
  );
}

function transactionAmount(transaction: Transaction): number {
  if (transaction.type === TransactionTypes.Installments) {
    return transaction.chargedAmount;
  }
  return transaction.status === TransactionStatuses.Pending
    ? transaction.originalAmount
    : transaction.chargedAmount;
}
