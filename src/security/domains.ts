import { CompanyTypes } from "israeli-bank-scrapers";
import { createLogger } from "../utils/logger.js";
import { type BrowserContext, type HTTPRequest, TargetType } from "puppeteer";
import { ClientRequestInterceptor } from "@mswjs/interceptors/ClientRequest";
import { DomainRuleManager, loadDomainRules, Rule } from "./domainRules.js";

const logger = createLogger("domain-security");

const blockedByCompany: Map<CompanyTypes, Set<string>> = new Map();
const allowedByCompany: Map<CompanyTypes, Set<string>> = new Map();
const domainsByCompany: Map<CompanyTypes, Set<string>> = new Map();
const pagesByCompany: Map<CompanyTypes, Set<string>> = new Map();
const domainsFromNode: Set<string> = new Set();

function trackRequestByRule(
  domain: string,
  companyId: CompanyTypes,
  rule: Rule,
) {
  const maps = {
    ALLOW: allowedByCompany,
    BLOCK: blockedByCompany,
    DEFAULT: allowedByCompany,
  } as const;

  if (!maps[rule].has(companyId)) {
    maps[rule].set(companyId, new Set());
  }
  maps[rule].get(companyId)!.add(domain);
  logger(`[${companyId}] ${rule} request for domain: ${domain}`);
}

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
    const rules = loadDomainRules();
    browserContext.on("targetcreated", async (target) => {
      switch (target.type()) {
        case TargetType.PAGE:
        case TargetType.WEBVIEW:
        case TargetType.BACKGROUND_PAGE: {
          logger(`Target created`, target.type());
          const page = await target.page();
          page?.on("request", (request) => {
            const currentUrl = page.url();
            handleRequest(request, currentUrl, companyId, rules);
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
  rules: DomainRuleManager,
) {
  try {
    const url = new URL(request.url());
    if (!(validateUrl(url.hostname) && validateUrl(pageUrl))) {
      return;
    }
    if (!pagesByCompany.has(companyId)) {
      pagesByCompany.set(companyId, new Set());
    }
    pagesByCompany.get(companyId)!.add(url.hostname);

    const rule = rules.getRule(url, companyId);
    trackRequestByRule(url.hostname, companyId, rule);
    if (
      rule === "BLOCK" ||
      (rule === "DEFAULT" && process.env.BLOCK_BY_DEFAULT)
    ) {
      logger(`[${companyId}] Blocking request to ${url.hostname}`);
      request.abort();
    }

    logger(`[${companyId}] request ${pageUrl}->${url.hostname}`);
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
    Array.from(domainsByCompany.entries()).map(([company, domains]) => [
      company,
      {
        pages: Array.from(pagesByCompany.get(company) ?? []),
        domains: Array.from(domains),
      },
    ]),
  );
  const infraDomains = Array.from(domainsFromNode);
  await report({ ...domainsRecord, infra: infraDomains });
  logger(`Reported used domains`, { ...domainsRecord, infra: infraDomains });
}
