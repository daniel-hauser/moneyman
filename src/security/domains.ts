import { CompanyTypes } from "israeli-bank-scrapers";
import { createLogger } from "../utils/logger.js";
import { type BrowserContext, type HTTPRequest, TargetType } from "puppeteer";
import { ClientRequestInterceptor } from "@mswjs/interceptors/ClientRequest";

const logger = createLogger("domain-security");

const domainsByCompany: Map<CompanyTypes, Map<string, Set<string>>> = new Map();
const domainsFromNode: Set<string> = new Set();

export function monitorNodeConnections() {
  if (process.env.DOMAIN_TRACKING_ENABLED) {
    const interceptor = new ClientRequestInterceptor();
    interceptor.apply();
    interceptor.on("request", ({ request }) => {
      logger(`Outgoing request: ${request.method} ${request.url}`);
      const { hostname } = new URL(request.url);
      domainsFromNode.add(hostname);
    });
  }
}

export async function initDomainTracking(
  browserContext: BrowserContext,
  companyId: CompanyTypes,
): Promise<void> {
  if (process.env.DOMAIN_TRACKING_ENABLED) {
    browserContext.on("targetcreated", async (target) => {
      switch (target.type()) {
        case TargetType.PAGE:
        case TargetType.WEBVIEW:
        case TargetType.BACKGROUND_PAGE: {
          logger(`Target created`, target.type());
          const page = await target.page();
          page?.on("request", (request) => {
            const currentUrl = page.url();
            handleRequest(request, currentUrl, companyId);
          });
          break;
        }
        default:
          break;
      }
    });
  }
}

function validateUrl(url: string): boolean {
  return url !== "about:blank" && url !== "";
}

function handleRequest(
  request: HTTPRequest,
  pageUrl: string,
  companyId: CompanyTypes,
) {
  try {
    const { hostname } = new URL(request.url());
    if (!(validateUrl(hostname) && validateUrl(pageUrl))) {
      return;
    }

    logger(`[${companyId}] request ${pageUrl}->${hostname}`);

    if (!domainsByCompany.has(companyId)) {
      domainsByCompany.set(companyId, new Map());
    }

    const companyDomains = domainsByCompany.get(companyId)!;
    if (!companyDomains.has(pageUrl)) {
      companyDomains.set(pageUrl, new Set());
    }
    companyDomains.get(pageUrl)!.add(hostname);
  } catch (error) {
    logger(`Failed to record domain access`, error);
  }
}

export async function reportUsedDomains(
  report: (
    domains: Partial<Record<CompanyTypes | "infra", unknown>>,
  ) => Promise<void>,
): Promise<void> {
  if (domainsByCompany.size === 0) {
    logger(`No domains recorded`);
    return;
  }

  logger(`Reporting used domains`, domainsByCompany);
  const domainsRecord = Object.fromEntries(
    Array.from(domainsByCompany.entries()).map(([company, pages]) => [
      company,
      {
        pages: Array.from(new Set(pages.keys())),
        domains: Array.from(
          new Set(Array.from(pages.values()).flatMap((d) => Array.from(d))),
        ),
      },
    ]),
  );

  domainsRecord.infra = {
    pages: [],
    domains: Array.from(domainsFromNode),
  };

  await report(domainsRecord);
  logger(`Reported used domains`, domainsRecord);
}
