import { CompanyTypes } from "israeli-bank-scrapers";
import { createLogger } from "../utils/logger.js";
import { type BrowserContext, TargetType } from "puppeteer";
import { ClientRequestInterceptor } from "@mswjs/interceptors/ClientRequest";
import { DomainRuleManager } from "./domainRules.js";
import { addToKeyedSet } from "../utils/collections.js";

const logger = createLogger("domain-security");

const domainsFromNode: Set<string> = new Set();
const pagesByCompany: Map<CompanyTypes, Set<string>> = new Map();
const blockedByCompany: Map<CompanyTypes, Set<string>> = new Map();
const allowedByCompany: Map<CompanyTypes, Set<string>> = new Map();
const requestOverridesError: Map<CompanyTypes, Set<string>> = new Map();

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

              if (ignoreUrl(url.hostname)) {
                const { action } = request.interceptResolutionState();
                await request.continue().catch((error) => {
                  handleRequestError(companyId, url, action, error, "CONTINUE");
                });
                return;
              }

              if (rules.isBlocked(url, companyId)) {
                addToKeyedSet(blockedByCompany, companyId, url.hostname);
                logger(
                  `[${companyId}] Blocking ${pageUrl.hostname}->${url.hostname}`,
                );

                const { action } = request.interceptResolutionState();
                await request.abort().catch((error) => {
                  handleRequestError(companyId, url, action, error, "ABORT");
                });
              } else {
                addToKeyedSet(allowedByCompany, companyId, url.hostname);
                logger(
                  `[${companyId}] Allowing ${pageUrl.hostname}->${url.hostname}`,
                );
                const { action } = request.interceptResolutionState();
                await request.continue().catch((error) => {
                  handleRequestError(companyId, url, action, error, "CONTINUE");
                });
              }
            });
          } else {
            page.on("request", async (request) => {
              const { hostname } = new URL(request.url());
              if (!ignoreUrl(hostname)) {
                addToKeyedSet(allowedByCompany, companyId, hostname);
              }

              const pageUrl = new URL(page.url());
              logger(`[${companyId}] ${pageUrl.hostname}->${hostname}`);
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

function handleRequestError(
  companyId: CompanyTypes,
  url: URL,
  action: string,
  error: Error,
  type: "ABORT" | "CONTINUE",
): void {
  const message = `[${type}] ${url.hostname} ${error.message}. interceptResolutionState was ${action}`;
  addToKeyedSet(requestOverridesError, companyId, message);
  logger(`[${companyId}] ${message}`);
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
