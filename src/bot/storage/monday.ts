const {
  MONDAY_BOARD_ID,
  MONDAY_TOKEN,
  currentDate,
  systemName,
  TRANSACTION_HASH_TYPE,
} = process.env;
import axios from 'axios';
import { parseISO, format } from "date-fns";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { createLogger, logToPublicLog } from "../../utils/logger.js";
import { TransactionRow, TransactionStorage } from '../../types';
import { SaveStats } from '../saveStats';
import type { MoneymanConfig } from "../../config.js";

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
  identifier: string | number;
  chargedCurrency: string;
  processedDate: string;
}
export class MondayStorage implements TransactionStorage {

  existingTransactionsHashes = new Set<string>();
  private initPromise: null | Promise<void> = null;
  private uniqueIdColumnID = "text__1"

  constructor(private config: MoneymanConfig) { }

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
    if (!MONDAY_BOARD_ID) {
      throw new Error('MONDAY_BOARD_ID is not defined');
    }
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
    const today = new Date();
    // Calculate past date by subtracting `daysAgo`
    const pastDate = new Date(today);
    pastDate.setDate(today.getDate() - 60);

    // Calculate future date by adding 2 months
    const futureDate = new Date(today);
    futureDate.setMonth(today.getMonth() + 2);
    const futureDateString = this.formatDate(futureDate);
    const pastDateString = this.formatDate(pastDate);

    const query = `
      query {
        boards(ids: ${boardId}) {
          items_page (limit: 500, query_params:{rules: [{column_id: "date", compare_value: ["${pastDateString}","${futureDateString}"], operator:between}]operator:and}) {
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

  async saveTransactions(
    txns: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>
  ) {
    await this.init();

    const txToSend: MondayTransaction[] = [];

    const stats = {
      name: "MondayStorage",
      table: MONDAY_BOARD_ID,
      total: txns.length,
      added: 0,
      pending: 0,
      existing: 0,
      otherSkipped: 0,
    } satisfies SaveStats;

    for (const tx of txns) {
      //Handeling existing transactions
      if (TRANSACTION_HASH_TYPE === "moneyman") {
        // Use the new uniqueId as the unique identifier for the transactions if the hash type is moneyman
        if (this.existingTransactionsHashes.has(tx.uniqueId)) {
          stats.existing++;
          stats.otherSkipped++;
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
          stats.otherSkipped++;
        }

        continue;
      }

      if (tx.status === TransactionStatuses.Pending) {
        stats.pending++;
        stats.otherSkipped++;
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
      logToPublicLog(
        `sending ${txToSend.length} transactions to Monday`,
      );
      if (!MONDAY_BOARD_ID) {
        throw new Error('MONDAY_BOARD_ID is not defined');
      }
      const resp = await this.createItemsFromTransactions(+MONDAY_BOARD_ID, txToSend);

      logToPublicLog("transactions sent to Monday successfully!");
      stats.otherSkipped += stats.existing;
    }

    return stats;

  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed, so add 1
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Function to create items from a list of MondayTransactions
  private async createItemsFromTransactions(boardId: number, transactions: MondayTransaction[], delayMs: number = 3000): Promise<void> {
    for (const transaction of transactions) {
      await this.createMondayItem(boardId, transaction);
      await this.delay(delayMs); // Introduce delay between requests
    }
  }
  // Function to create an item on Monday.com
  private async createMondayItem(boardId: number, transaction: MondayTransaction): Promise<void> {
    // First check if item exists
    const itemExists = await this.checkItemExists(boardId, transaction.uniqueId);
    if (itemExists) {
      logToPublicLog(`Item with uniqueId ${transaction.uniqueId} already exists, skipping creation`);
      return;
    }

    const itemName = escapeString(transaction.description);
    const columnValues = escapeString(this.getColumnValues(transaction));

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
       item_name: "${transaction.description.replace(/"/g, '\\"')}",
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
        console.error('Error creating item:', response.data.errors, columnValues);
      } else {
        logger('Item created successfully:', response.data.data.create_item.id);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  }

  private async checkItemExists(boardId: number, uniqueId: string): Promise<boolean> {
    const headers = {
      'Authorization': MONDAY_TOKEN,
      'Content-Type': 'application/json'
    };

    const query = `
      query {
  items_page_by_column_values (limit: 1, board_id: ${boardId}, columns: [{column_id: "text__1", column_values: ["${uniqueId}"]}]) {
    cursor
    items {
      id
      name
    }
  }
}
    `;

    try {
      const response = await axios.post(URL, { query }, { headers });

      if (response.data.errors) {
        console.error('Error checking item existence:', response.data.errors);
        return false;
      }

      return response.data.data.items_page_by_column_values.items.length > 0;
    } catch (error) {
      console.error('Error checking item existence:', error);
      return false;
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
      account: `${tx.companyId} ${tx.account}`,
      uniqueId: TRANSACTION_HASH_TYPE === "moneyman" ? tx.uniqueId : tx.hash,
      scraped_at: format(Date.now(), "yyyy-MM-dd"),
      scraped_by: systemName ?? "",
      identifier: String(tx.identifier ?? ""),
      chargedCurrency: tx.chargedCurrency ?? "",
      processedDate: format(parseISO(tx.processedDate), "yyyy-MM-dd", {}),
    };
  }

  // Helper function to convert MondayTransaction to column_values string
  private getColumnValues(transaction: MondayTransaction): string {
    const columnValues = {
      date: transaction.date,
      numbers: transaction.amount,
      text1: transaction.memo.replace(/"/g, ''),
      date8: transaction.scraped_at,
      text0: transaction.identifier,
      status__1: transaction.chargedCurrency,
      text__1: transaction.uniqueId,
      status03__1: transaction.account,
      date_mkpn8z61: transaction.processedDate,
      category_mkmwkz7p: {
        labels: [transaction.category]
      }
    };

    return JSON.stringify(columnValues).replace(/"/g, '\\"');
  }
}

function escapeString(input: string): string {
  return input.replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
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
