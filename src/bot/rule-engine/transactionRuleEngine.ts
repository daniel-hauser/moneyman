import Trool from "trool";
import { MoneymanTransaction } from "./moneymanTransaction.js";
import { TransactionRow } from "../../types.js";
import { createLogger } from "../../utils/logger.js";
import * as fs from "fs";

const {
  RULE_TABLE_CSV_FILE_PATH,
  WORKSHEET_NAME,
  GOOGLE_SHEET_ID = "",
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
} = process.env;

const logger = createLogger("TransactionRuleEngine");

export class TransactionRuleEngine {
  private decisionTableCsv: string;
  private decisionTableFound: boolean;

  constructor(csvFilePath?: string) {
    logger("Load decision table");
    if (csvFilePath && fs.existsSync(csvFilePath)) {
      // CTOR relative path
      this.decisionTableCsv = this.readFileAsString(csvFilePath);
    } else if (
      RULE_TABLE_CSV_FILE_PATH &&
      fs.existsSync(RULE_TABLE_CSV_FILE_PATH)
    ) {
      // Env variable relative path
      this.decisionTableCsv = this.readFileAsString(RULE_TABLE_CSV_FILE_PATH);
    } else if (
      GOOGLE_SHEET_ID &&
      GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
    ) {
      // TODO - Get the string from user gsheet table if environment is set for using it
    }
    if (this.decisionTableCsv && this.decisionTableCsv !== "") {
      logger("Decision table loaded");
      this.decisionTableFound = true;
    } else {
      logger("Decision table not found ...");
      this.decisionTableFound = false;
    }
  }

  canApplyRules(): boolean {
    return this.decisionTableFound;
  }

  async applyRules(txns: Array<TransactionRow>): Promise<TransactionRow[]> {
    try {
      logger("Init rule engine");
      const TroolClass = (Trool as any).default;
      const trool = new TroolClass(false);
      await trool.init(this.decisionTableCsv, true);
      const factsHolder = {
        MoneymanTransactions: txns.map((trx) =>
          MoneymanTransaction.fromTransactionRow(trx),
        ),
      };
      const updatedFacts = trool.applyRules(factsHolder);
      logger("Storage rules applied on transactions");
      return updatedFacts.MoneymanTransactions.map((trx) =>
        trx.toTransactionRow(),
      );
    } catch (error) {
      logger(error);
      return txns;
    }
  }

  // Function to read a file and return its content as a string
  readFileAsString(filePath: string): string {
    return fs.readFileSync(filePath, { encoding: "utf-8" });
  }
}
