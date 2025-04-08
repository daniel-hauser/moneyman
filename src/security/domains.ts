import { CompanyTypes } from "israeli-bank-scrapers";
import { createLogger, logToMetadataFile } from "../utils/logger.js";
import { type BrowserContext, TargetType } from "puppeteer";
import { ClientRequestInterceptor } from "@mswjs/interceptors/ClientRequest";
import { DomainRuleManager } from "./domainRules.js";
import { addToKeyedSet } from "../utils/collections.js";

const logger = createLogger("domain-security");

const domainsFromNode: Set<string> = new Set();
const pagesByCompany: Map<CompanyTypes, Set<string>> = new Map();
const blockedByCompany: Map<CompanyTypes, Set<string>> = new Map();
const allowedByCompany: Map<CompanyTypes, Set<string>> = new Map();

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
    const rules = new DomainRuleManager();
    browserContext.on("targetcreated", async (target) => {
      switch (target.type()) {
        case TargetType.PAGE:
        case TargetType.WEBVIEW:
        case TargetType.BACKGROUND_PAGE: {
          logger(`Target created`, target.type());
          const page = await target.page();
          if (!page) {
            logger(`No page found for target, unexpected`);
            return;
          }

          page.on("framenavigated", (frame) => {
            logger(`Frame navigated: ${frame.url()}`);
            const { hostname, pathname } = new URL(page.url());
            addToKeyedSet(pagesByCompany, companyId, hostname + pathname);
          });

          const canIntercept = rules.hasAnyRule(companyId);
          if (canIntercept) {
            logger(`[${companyId}] Setting request interception`);
            await page.setRequestInterception(true);

            page.on("request", async (request) => {
              const url = new URL(request.url());
              const pageUrl = new URL(page.url());

              const reqKey = `${request.method()}(${request.resourceType()}) ${url.hostname}`;
              if (request.isInterceptResolutionHandled()) {
                logger(`[${companyId}] Request already handled ${reqKey}`);
                logToMetadataFile(
                  `[${companyId}] Request already handled ${reqKey}`,
                );
                return;
              }

              if (ignoreUrl(url.hostname) || !rules.isBlocked(url, companyId)) {
                addToKeyedSet(allowedByCompany, companyId, reqKey);
                logger(
                  `[${companyId}] Allowing ${pageUrl.hostname}->${reqKey}`,
                );
                await request.continue(undefined, 100);
              } else {
                addToKeyedSet(blockedByCompany, companyId, reqKey);
                logger(
                  `[${companyId}] Blocking ${pageUrl.hostname}->${reqKey}`,
                );
                await request.abort(undefined, 100);
              }
            });
          } else {
            page.on("request", async (request) => {
              const { hostname } = new URL(request.url());
              const reqKey = `${request.method()}(${request.resourceType()}) ${hostname}`;
              if (!ignoreUrl(hostname)) {
                addToKeyedSet(allowedByCompany, companyId, reqKey);
              }
              const pageUrl = new URL(page.url());
              logger(`[${companyId}] ${pageUrl.hostname}->${reqKey}`);
            });
          }

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

export async function getUsedDomains(): Promise<
  Partial<Record<CompanyTypes | "infra", unknown>>
> {
  const allCompanies = new Set([
    ...allowedByCompany.keys(),
    ...blockedByCompany.keys(),
  ]);
  if (allCompanies.size === 0) {
    logger(`No domains recorded`);
    return {};
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
  return { ...domainsRecord, infra: infraDomains };
}
