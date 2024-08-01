import {
  MONDAY_BOARD_ID,
  MONDAY_TOKEN,
  currentDate,
  systemName,
  TRANSACTION_HASH_TYPE,
} from "../config.js";
import axios from 'axios';
import { SaveStats, TransactionRow, TransactionStorage } from "../types.js";
import { createLogger } from "../utils/logger.js";
import { parseISO, format } from "date-fns";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { normalizeCurrency } from "../utils/currency.js";

const logger = createLogger("MondayStorage");
const URL = 'https://api.monday.com/v2';
interface MondayTransaction {
  uniqueId: string;
  account: string;
  date: string;
  amount: number;
  description: string;
  status: 'cleared' | 'pending';
  type: 'income' | 'expense';
  memo: string;
  category: string;
  scraped_by: string;
  scraped_at: string;
  identifier: string;
  chargedCurrency: string

}
export class MondayStorage implements TransactionStorage {

  existingTransactionsHashes = new Set<string>();
  private initPromise: null | Promise<void> = null;
  private uniqueIdColumnID = "text__1"

  async init() {
    // Init only once
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await this.loadHashes();
      })();
    }

    await this.initPromise;
  }

  canSave() {
    return Boolean(MONDAY_BOARD_ID && MONDAY_TOKEN);
  }

  private async loadHashes() {
    const items = await this.getAllItemsFromBoard(+MONDAY_BOARD_ID);
    for (const item of items) {
      const columnValue = item.column_values.find((col: any) => col.id === this.uniqueIdColumnID);
      if (columnValue && columnValue.text) {
        this.existingTransactionsHashes.add(columnValue.text);
      }
    }
    console.info(`${this.existingTransactionsHashes.size} hashes loaded`);
  }

  async getAllItemsFromBoard(boardId: number): Promise<Item[]> {
    const headers = {
      'Authorization': MONDAY_TOKEN,
      'Content-Type': 'application/json'
    };

    const query = `
      query {
        boards(ids: ${boardId}) {
          items_page {
            items {
              id
              column_values {
                id
                text
              }
            }
          }
        }
      }
    `;

    try {
      const response = await axios.post<ResponseData>(URL, { query: query }, { headers: headers });

      if (response.data.errors) {
        console.error('Error fetching items:', response.data.errors);
        return [];
      } else {
        return response.data.data.boards[0].items_page.items;
      }
    } catch (error) {
      console.error('Error:', error);
      return [];
    }
  }


  async saveTransactions(txns: Array<TransactionRow>) {
    await this.init();

    const txToSend: MondayTransaction[] = [];

    const stats = {
      name: "MondayStorage",
      table: MONDAY_BOARD_ID,
      total: txns.length,
      added: 0,
      pending: 0,
      existing: 0,
      skipped: 0,
    } satisfies SaveStats;

    for (const tx of txns) {
      //Handeling existing transactions
      if (TRANSACTION_HASH_TYPE === "moneyman") {
        // Use the new uniqueId as the unique identifier for the transactions if the hash type is moneyman
        if (this.existingTransactionsHashes.has(tx.uniqueId)) {
          stats.existing++;
          stats.skipped++;
          continue;
        }
      }

      if (this.existingTransactionsHashes.has(tx.hash)) {
        if (TRANSACTION_HASH_TYPE === "moneyman") {
          logger(`Skipping, old hash ${tx.hash} is already in the sheet`);
        }

        // To avoid double counting, skip if the new hash is already in the sheet
        if (!this.existingTransactionsHashes.has(tx.uniqueId)) {
          stats.existing++;
          stats.skipped++;
        }

        continue;
      }

      if (tx.status === TransactionStatuses.Pending) {
        stats.pending++;
        stats.skipped++;
        continue;
      }
      // Converting to Monday format.
      const mondayTx = this.convertTransactionToMondayItem(tx);
      // Add non-pending and non-empty account ID transactions to the array.
      txToSend.push(mondayTx);
    }

    if (txToSend.length > 0) {
      // TODO - Build JSON based personal rule engine for tagging transactions
      // this.tagTransactionsByRules(txToSend);

      // Send transactions to Monday
      logger(
        `sending to Monday`,
      );
      const resp = await this.createItemsFromTransactions(+MONDAY_BOARD_ID, txToSend);

      logger("transactions sent to Monday successfully!");
      // stats.added = resp.addedTransactionIds.length;
      // stats.existing = resp.duplicatedTransactionIds.length;
      stats.skipped += stats.existing;
    }

    return stats;

  }
  // Function to create items from a list of MondayTransactions
  private async createItemsFromTransactions(boardId: number, transactions: MondayTransaction[]): Promise<void> {
    for (const transaction of transactions) {
      await this.createMondayItem(boardId, transaction);
    }
  }
  // Function to create an item on Monday.com
  private async createMondayItem(boardId: number, transaction: MondayTransaction): Promise<void> {
    // Headers for the request
    const headers = {
      'Authorization': MONDAY_TOKEN,
      'Content-Type': 'application/json'
    };

    // The GraphQL query for creating an item
    const query = `
    mutation {
      create_item (board_id: ${boardId},
       create_labels_if_missing: true,
       item_name: "${transaction.description}",
        column_values: "${this.getColumnValues(transaction)}") {

        id
      }
    }
  `;

    try {
      // Send the request
      const response = await axios.post(URL, { query: query }, { headers: headers });

      // Handle the response
      if (response.data.errors) {
        console.error('Error creating item:', response.data.errors);
      } else {
        console.log('Item created successfully:', response.data.data.create_item.id);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  }

  private convertTransactionToMondayItem(
    tx: TransactionRow
  ): MondayTransaction {
    return {
      date: format(parseISO(tx.date), "yyyy-MM-dd", {}),
      amount: tx.chargedAmount,
      description: tx.description,
      status:
        tx.status === TransactionStatuses.Completed ? "cleared" : "pending",
      type: tx.chargedAmount > 0 ? "income" : "expense",
      memo: tx.memo ?? "",
      category: tx.category ?? "",
      account: tx.account,
      uniqueId: TRANSACTION_HASH_TYPE === "moneyman" ? tx.uniqueId : tx.hash,
      scraped_at: currentDate,
      scraped_by: systemName,
      identifier: `${tx.identifier ?? ""}`,
      chargedCurrency: normalizeCurrency(tx.chargedCurrency),
    };
  }

  // Helper function to convert MondayTransaction to column_values string
  private getColumnValues(transaction: MondayTransaction): string {
    const columnValues = {
      date: transaction.date,
      numbers: transaction.amount,
      text1: transaction.memo,
      dropdown__1: {
        labels: [transaction.account]
      },
      date8: transaction.scraped_at,
      text0: transaction.identifier,
      status3: transaction.category,
      status__1: transaction.chargedCurrency,
      text__1: transaction.uniqueId
    };

    return JSON.stringify(columnValues).replace(/"/g, '\\"');
  }
}

// TODO: extratct to monday api helper with the function above of graphQL 

interface ColumnValue {
  id: string;
  text: string;
}

interface Item {
  id: string;
  column_values: ColumnValue[];
}

interface ItemsPage {
  items: Item[];
}

interface Board {
  items_page: ItemsPage;
}

interface ResponseData {
  data: {
    boards: Board[];
  };
  errors?: any[];
}
