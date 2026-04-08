/**
 * Launches a browser, waits for you to log in and complete OTP,
 * then exports cookies as JSON to stdout.
 *
 * Usage:
 *   npm run export-cookies -- --company hapoalim --url https://www.bankhapoalim.co.il
 *
 * Steps:
 *   1. A browser window opens and navigates to the given URL.
 *   2. Log in manually and complete OTP / 2FA.
 *   3. Press Enter in the terminal when done.
 *   4. Cookies are printed as JSON keyed by companyId.
 *
 * Run multiple times for different providers, then merge the JSON objects
 * into a single secret:
 *   { "hapoalim": [...], "visaCal": [...] }
 */
import puppeteer from "puppeteer";
import { browserArgs, browserExecutablePath } from "../scraper/browser.js";
import { createInterface } from "readline";

const company = process.argv.find(
  (a, i) => process.argv[i - 1] === "--company",
);
const url = process.argv.find((a, i) => process.argv[i - 1] === "--url");

if (!company || !url) {
  console.error(
    "Usage: npm run export-cookies -- --company <companyId> --url <bank-login-url>",
  );
  process.exit(1);
}

const browser = await puppeteer.launch({
  headless: false,
  args: browserArgs.filter((arg) => arg !== "--no-sandbox"),
  executablePath: browserExecutablePath,
  ignoreDefaultArgs: ["--enable-automation"],
});

try {
  const page = await browser.newPage();
  await page.goto(url);

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  await new Promise<void>((resolve) =>
    rl.question("Log in and complete OTP, then press Enter...", () => {
      rl.close();
      resolve();
    }),
  );

  const cookies = await page.browserContext().cookies();
  console.log(JSON.stringify({ [company]: cookies }));
} finally {
  await browser.close();
}
