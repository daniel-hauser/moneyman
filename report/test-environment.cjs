const { TestEnvironment } = require("jest-environment-jsdom");
const { ReadableStream } = require("node:stream/web");
const { JSDOM } = require("jsdom");

// Report DOM tests also import scraper fixtures that depend on Node's streams.
module.exports = class ReportEnvironment extends TestEnvironment {
  async setup() {
    await super.setup();
    this.global.ReadableStream = ReadableStream;
    this.global.Highlight = Set;
    this.global.CSS = { highlights: new Map() };
    this.windows = [];
    this.global.createReportWindow = () => {
      const dom = new JSDOM("", { runScripts: "outside-only" });
      this.windows.push(dom.window);
      return dom.window;
    };
  }

  async teardown() {
    for (const window of this.windows) window.close();
    await super.teardown();
  }
};
