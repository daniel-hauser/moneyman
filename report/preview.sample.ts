import { renderHTMLReport, type RunReport } from "../src/bot/runReport.js";
import { CompanyTypes } from "israeli-bank-scrapers/lib/definitions.js";
import {
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions.js";
import { ScraperErrorTypes } from "israeli-bank-scrapers/lib/scrapers/errors.js";

const startedAt = new Date("2026-10-31T08:00:00Z");
const start = startedAt.getTime();

const transactions = [
  {
    description: "Fictional Cedar Market",
    amount: -186.4,
    category: "Groceries",
  },
  { description: "Fictional Moonbeam Cafe", amount: -32, category: "Dining" },
  {
    description: "Fictional Harbor Transit",
    amount: -18,
    category: "Transport",
  },
  {
    description: "Fictional Meadow Books",
    amount: -94.9,
    category: "Shopping",
  },
  {
    description: "Synthetic missing amount example",
    amount: -74.5,
    category: "Software",
  },
  { description: "Fictional Garden Cinema", amount: -88, category: "Leisure" },
  {
    description: "Fictional Summit Outfitters",
    amount: -245,
    category: "Shopping",
  },
  {
    description: "Fictional Bluebird Refund",
    amount: 49.9,
    category: "Refund",
  },
].map(({ description, amount, category }, index) => ({
  identifier: `synthetic-${index + 1}`,
  type: index === 6 ? TransactionTypes.Installments : TransactionTypes.Normal,
  date: `2026-10-${String(23 + index).padStart(2, "0")}T00:00:00Z`,
  processedDate: `2026-10-${String(23 + index).padStart(2, "0")}T00:00:00Z`,
  originalAmount: index === 4 ? -20 : amount,
  originalCurrency: index === 4 ? "USD" : "ILS",
  chargedAmount: index === 4 ? null : amount,
  chargedCurrency: "ILS",
  description,
  category,
  memo: "SYNTHETIC sample — not a real purchase",
  status:
    index === 7 ? TransactionStatuses.Pending : TransactionStatuses.Completed,
  ...(index === 6 ? { installments: { number: 2, total: 4 } } : {}),
}));

const report = {
  startedAt,
  endedAt: new Date(start + 18_400),
  failed: true,
  scrape: {
    status: ["SYNTHETIC demo: two providers succeeded, one simulated failure"],
    totalTimeSec: 12.6,
  },
  summary: {
    results: [
      {
        companyId: CompanyTypes.hapoalim,
        result: {
          success: true,
          accounts: [
            {
              accountNumber: "DEMO-CHECKING-0001",
              balance: 12480.75,
              currency: "ILS",
              txns: [
                {
                  ...transactions[0],
                  identifier: "synthetic-salary",
                  description: "Fictional Acorn Studio — salary",
                  originalAmount: 14500,
                  chargedAmount: 14500,
                  category: "Income",
                },
                ...transactions.slice(0, 4),
              ],
            },
            {
              accountNumber: "DEMO-SAVINGS-0002",
              balance: 35000,
              currency: "ILS",
              savingsAccount: true,
              txns: [],
            },
          ],
        },
      },
      {
        companyId: CompanyTypes.max,
        result: {
          success: true,
          accounts: [
            { accountNumber: "DEMO-CARD-0003", txns: transactions.slice(4) },
          ],
        },
      },
      {
        companyId: CompanyTypes.visaCal,
        result: {
          success: false,
          errorType: ScraperErrorTypes.Generic,
          errorMessage:
            "SYNTHETIC failure: fictional provider timed out.\nNo bank was contacted.",
        },
      },
    ],
  },
  storages: {
    "Google Sheets (synthetic)": {
      state: "done",
      stats: {
        name: "Google Sheets (synthetic)",
        table: "Fictional household ledger",
        total: 9,
        added: 6,
        existing: 2,
        pending: 1,
        otherSkipped: 0,
      },
      durationMs: 3400,
      steps: [
        { name: "Read existing rows", durationMs: 1100 },
        { name: "Append fictional transactions", durationMs: 2300 },
      ],
    },
    "Local JSON (synthetic)": {
      state: "done",
      stats: {
        name: "Local JSON (synthetic)",
        table: "demo-transactions.json",
        total: 9,
        added: 9,
        existing: 0,
        pending: 0,
        otherSkipped: 0,
      },
      durationMs: 120,
      steps: [{ name: "Serialize fictional transactions", durationMs: 120 }],
    },
    "YNAB (synthetic)": {
      state: "error",
      message:
        "SYNTHETIC failure: fictional budget service unavailable.\nNo export was attempted.",
    },
  },
  timings: [
    {
      id: "bank",
      kind: "scraper",
      name: "hapoalim (synthetic)",
      startedAt: start,
      endedAt: start + 9200,
    },
    {
      id: "card",
      kind: "scraper",
      name: "max (synthetic)",
      startedAt: start + 300,
      endedAt: start + 12600,
    },
    {
      id: "failed-card",
      kind: "scraper",
      name: "visaCal (synthetic)",
      startedAt: start + 500,
      endedAt: start + 11000,
      failed: true,
    },
    {
      id: "sheets",
      kind: "storage",
      name: "Google Sheets (synthetic)",
      startedAt: start + 12600,
      endedAt: start + 16000,
    },
    {
      id: "read",
      parentId: "sheets",
      kind: "step",
      name: "Read existing rows",
      startedAt: start + 12600,
      endedAt: start + 13700,
    },
    {
      id: "append",
      parentId: "sheets",
      kind: "step",
      name: "Append fictional transactions",
      startedAt: start + 13700,
      endedAt: start + 16000,
    },
    {
      id: "json",
      kind: "storage",
      name: "Local JSON (synthetic)",
      startedAt: start + 16000,
      endedAt: start + 16120,
    },
    {
      id: "ynab",
      kind: "storage",
      name: "YNAB (synthetic)",
      startedAt: start + 16120,
      endedAt: start + 18400,
      failed: true,
    },
  ],
  errors: [
    {
      caller: "visaCal (synthetic)",
      message:
        "SYNTHETIC timeout after 10.5 seconds.\nNo real account, credentials, or network request.",
    },
    {
      caller: "YNAB (synthetic)",
      message: "SYNTHETIC service unavailable (503).\nThis error is fictional.",
    },
  ],
  screenshots: [],
  notices: [
    "SYNTHETIC preview only. All accounts, transactions, logs, and failures are fictional.",
  ],
} satisfies RunReport;

export const previewHTML = renderHTMLReport(
  report,
  [
    "08:00:00 moneyman:preview SYNTHETIC sample run; no scrapers or storages executed",
    "08:00:09 moneyman:preview Fictional checking and savings accounts ready",
    "08:00:11 moneyman:preview Simulated visaCal timeout",
    "08:00:12 moneyman:preview Fictional card transactions ready",
    "08:00:16 moneyman:preview Simulated Sheets and JSON saves completed",
    "08:00:18 moneyman:preview Simulated YNAB failure; sample run finished",
  ].join("\n"),
);
