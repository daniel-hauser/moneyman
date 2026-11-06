import { createRunReport, renderHTMLReport } from "../src/bot/runReport.js";
import {
  diagnosticFixture,
  diagnosticTrace,
  ids,
  multilineDiagnostic,
  rawConsole,
} from "./diagnostics-fixture.js";

// Opt in on machines with Chrome installed; ordinary unit tests need no browser.
const browserTest =
  process.env.MONEYMAN_REPORT_BROWSER_TEST === "true" ? test : test.skip;

browserTest(
  "generated offline HTML filters actual spans and whole events without network or script injection",
  async () => {
    const { default: puppeteer } = await import("puppeteer");
    const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      const network: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      page.on("request", (request) => {
        if (/^https?:/i.test(request.url())) network.push(request.url());
      });
      const html = renderHTMLReport(
        createRunReport(new Date("2024-01-01T10:00:00Z")),
        { console: rawConsole, telemetry: diagnosticFixture() },
      );
      await page.setContent(html);
      await page.waitForSelector("html.report-interactive", { timeout: 10000 });
      expect(
        await page.$eval("#diagnostics-count", (node) => node.textContent),
      ).toBe("(21 of 21 events)");
      const start = performance.now();
      await page.select("#diagnostic-trace", diagnosticTrace);
      await page.select("#facet-account-company", "invented-bank");
      await page.select("#facet-account-index", "0");
      await page.select("#facet-storage-name", "invented-A");
      await page.select(
        "#diagnostic-operation",
        `${diagnosticTrace}/${ids.first}`,
      );
      await page.select("#diagnostic-type", "log");
      await page.type("#search-diagnostics", "FIRST LINE*continuation frame");
      await page.waitForFunction(
        () => document.querySelectorAll(".diagnostic-body").length === 1,
      );
      expect(
        await page.$eval(".diagnostic-body", (node) => node.textContent),
      ).toBe(multilineDiagnostic);
      expect(
        await page.$eval("#diagnostics-count", (node) => node.textContent),
      ).toBe("(1 of 21 events)");
      expect(performance.now() - start).toBeLessThan(5000);
      expect(
        await page.$eval(".diagnostic-context", (node) => node.textContent),
      ).toContain("main.run → scraper.account");
      await page.click("#diagnostic-events summary");
      expect(
        await page.$eval(
          ".diagnostic-body",
          (node) => (node as HTMLElement).offsetHeight,
        ),
      ).toBeGreaterThan(30);
      expect(await page.evaluate(() => "injected" in globalThis)).toBe(false);
      expect(network).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
  30000,
);
