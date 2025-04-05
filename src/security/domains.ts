import { CompanyTypes } from "israeli-bank-scrapers";
import { createLogger } from "../utils/logger.js";
import { type BrowserContext, TargetType } from "puppeteer";
import { ClientRequestInterceptor } from "@mswjs/interceptors/ClientRequest";
import { loadDomainRules } from "./domainRules.js";

const logger = createLogger("domain-security");

const domainsFromNode: Set<string> = new Set();
const pagesByCompany: Map<CompanyTypes, Set<string>> = new Map();
const blockedByCompany: Map<CompanyTypes, Set<string>> = new Map();
const allowedByCompany: Map<CompanyTypes, Set<string>> = new Map();

function trackRequest(
  domain: string,
  companyId: CompanyTypes,
  isBlocked: boolean,
) {
  const domainsByCompany = isBlocked ? blockedByCompany : allowedByCompany;
  if (!domainsByCompany.has(companyId)) {
    domainsByCompany.set(companyId, new Set());
  }
  domainsByCompany.get(companyId)!.add(domain);
  logger(
    `[${companyId}] ${isBlocked ? "BLOCK" : "ALLOW"} request for domain: ${domain}`,
  );
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
          await page?.setRequestInterception(rules.hasAnyRule(companyId));
          page?.on("request", async (request) => {
            try {
              const pageUrl = page.url();
              const url = new URL(request.url());
              const { hostname } = url;

              if (!ignoreUrl(pageUrl) && !ignoreUrl(hostname)) {
                if (!pagesByCompany.has(companyId)) {
                  pagesByCompany.set(companyId, new Set());
                }
                pagesByCompany.get(companyId)!.add(pageUrl);

                const block = rules.isBlocked(url, companyId);
                trackRequest(hostname, companyId, block);
                if (block) {
                  logger(`[${companyId}] Blocking request to ${hostname}`);
                  return await request.abort();
                }
              }

              logger(`[${companyId}] Allowing request ${pageUrl}->${hostname}`);
              await request.continue();
            } catch (error) {
              logger(`Error handling request: ${error.message}`);
            }
          });
          break;
        }
        default:
          break;
      }
    });
  }
}

function ignoreUrl(url: string): boolean {
  return url === "about:blank" || url === "" || url === "invalid";
}

export async function reportUsedDomains(
  report: (
    domains: Partial<Record<CompanyTypes | "infra", unknown>>,
  ) => Promise<void>,
): Promise<void> {
  const allCompanies = new Set([
    ...allowedByCompany.keys(),
    ...blockedByCompany.keys(),
  ]);
  if (allCompanies.size === 0) {
    logger(`No domains recorded`);
    return;
  }

  logger(`Reporting used domains`, { allowedByCompany, blockedByCompany });
  const domainsRecord = Object.fromEntries(
    Array.from(allCompanies).map((company) => [
      company,
      {
        pages: Array.from(pagesByCompany.get(company) ?? []),
        allowed: Array.from(allowedByCompany.get(company) ?? []),
        blocked: Array.from(blockedByCompany.get(company) ?? []),
      },
    ]),
  );
  const infraDomains = Array.from(domainsFromNode);
  await report({ ...domainsRecord, infra: infraDomains });
  logger(`Reported used domains`, { ...domainsRecord, infra: infraDomains });
}
