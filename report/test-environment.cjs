const { TestEnvironment } = require("jest-environment-jsdom");
const { ReadableStream } = require("node:stream/web");

// Report DOM tests also import scraper fixtures that depend on Node's streams.
module.exports = class ReportEnvironment extends TestEnvironment {
  async setup() {
    await super.setup();
    this.global.ReadableStream = ReadableStream;
  }
};
