import { CompanyTypes } from "israeli-bank-scrapers";
import { createLogger, logToMetadataFile } from "../utils/logger.js";
import { type BrowserContext, TargetType } from "puppeteer";
import { ClientRequestInterceptor } from "@mswjs/interceptors/ClientRequest";
import { DomainRuleManager } from "./domainRules.js";
import { addToKeyedSet } from "../utils/collections.js";
import { config } from "../config.js";

const { scraping: scrapingConfig, security: securityConfig } = config.options;
const logger = createLogger("domain-security");

type CompanyToSet = Map<CompanyTypes, Set<string>>;

const domainsFromNode: Set<string> = new Set();
const pagesByCompany: CompanyToSet = new Map();
const blockedByCompany: CompanyToSet = new Map();
const allowedByCompany: CompanyToSet = new Map();
const resourceTypesByCompany: Map<string, CompanyToSet> = new Map();

export function monitorNodeConnections() {
  if (scrapingConfig.domainTracking) {
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
  if (scrapingConfig.domainTracking) {
    const rules = new DomainRuleManager(
      securityConfig.firewallSettings ?? [],
      securityConfig.blockByDefault,
    );
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

              const resourceType = request.resourceType();
              const reqKey = `${request.method()} ${url.hostname}`;

              if (request.isInterceptResolutionHandled()) {
                const message = `[${companyId}] Request already handled ${reqKey} ${resourceType}`;
                logger(message);
                logToMetadataFile(message);
                return;
              }

              if (!resourceTypesByCompany.has(reqKey)) {
                resourceTypesByCompany.set(reqKey, new Map());
              }

              addToKeyedSet(
                resourceTypesByCompany.get(reqKey)!,
                companyId,
                resourceType,
              );

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
    Array.from(allCompanies).map((company) => {
      function getArray(set: Map<CompanyTypes, Set<string>>) {
        return Array.from(set?.get(company) ?? []);
      }
      function withResourceType(key: string) {
        return `${key} [${getArray(resourceTypesByCompany.get(key)!).sort()}]`;
      }
      return [
        company,
        {
          pages: getArray(pagesByCompany),
          allowed: getArray(allowedByCompany).map(withResourceType),
          blocked: getArray(blockedByCompany).map(withResourceType),
        },
      ];
    }),
  );
  const infraDomains = Array.from(domainsFromNode);
  return { ...domainsRecord, infra: infraDomains };
}
