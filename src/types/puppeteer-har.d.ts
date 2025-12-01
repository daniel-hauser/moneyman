declare module "puppeteer-har" {
  import type { Page } from "puppeteer";

  interface HarStartOptions {
    /**
     * Path to save the HAR file
     */
    path?: string;
    /**
     * Whether to save response bodies
     */
    saveResponse?: boolean;
    /**
     * MIME types to capture response bodies for
     */
    captureMimeTypes?: string[];
  }

  interface HarData {
    log: {
      version: string;
      creator: {
        name: string;
        version: string;
      };
      entries: unknown[];
    };
  }

  class PuppeteerHar {
    constructor(page: Page);
    start(options?: HarStartOptions): Promise<void>;
    stop(): Promise<HarData | void>;
  }

  export = PuppeteerHar;
}
