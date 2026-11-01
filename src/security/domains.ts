import { CompanyTypes } from "israeli-bank-scrapers";
import { createLogger } from "../utils/logger.js";
import {
  runInLoggerContext,
  loggerContextStore,
} from "../utils/asyncContext.js";
import type { BrowserContext } from "puppeteer";
import { ClientRequestInterceptor } from "@mswjs/interceptors/ClientRequest";
import { DomainRuleManager } from "./domainRules.js";
import { addToKeyedSet } from "../utils/collections.js";
export type UsedDomains = Record<string, Record<string, string[]>>;
export type DomainTracker = ReturnType<typeof createDomainTracker>;

const logger = createLogger("domain-security");

type CompanyToSet = Map<CompanyTypes, Set<string>>;

export function createDomainTracker({
  domainTracking,
  firewallSettings = [],
  blockByDefault,
}: {
  readonly domainTracking: boolean;
  readonly firewallSettings?: readonly string[];
  readonly blockByDefault: boolean;
}) {
  const firewallRules = [...firewallSettings];
  const domainsFromNode: Map<string, Set<string>> = new Map();
  const pagesByCompany: CompanyToSet = new Map();
  const blockedByCompany: CompanyToSet = new Map();
  const allowedByCompany: CompanyToSet = new Map();
  const resourceTypesByCompany: Map<string, CompanyToSet> = new Map();

  const interceptor = domainTracking
    ? ClientRequestInterceptor.singleton(ClientRequestInterceptor)
    : undefined;
  const listeners = new AbortController();
  const tracker = {
    initDomainTracking,
    getUsedDomains,
    dispose: () => {
      listeners.abort();
      interceptor?.dispose(tracker);
    },
  };
  try {
    if (interceptor) {
      interceptor.apply(tracker);
      interceptor.on(
        "request",
        runInLoggerContext(({ request }) => {
          logger(`Outgoing request: ${request.method} ${request.url}`);
          const { hostname } = new URL(request.url);
          const context = loggerContextStore.getStore() ?? { prefix: "node" };
          const reqKey = `${request.method} ${hostname}`;
          addToKeyedSet(domainsFromNode, context.prefix, reqKey);
        }),
        { signal: listeners.signal },
      );
    }
  } catch (error) {
    tracker.dispose();
    throw error;
  }

  async function initDomainTracking(
    browserContext: BrowserContext,
    companyId: CompanyTypes,
  ): Promise<void> {
    if (domainTracking) {
      const context = loggerContextStore.getStore();

      const rules = new DomainRuleManager(
        companyId,
        firewallRules,
        blockByDefault,
      );
      browserContext.on(
        "targetcreated",
        runInLoggerContext(async (target) => {
          switch (target.type()) {
            // String literals used instead of TargetType enum because puppeteer is ESM-only
            // and Jest cannot import its value exports. Safe to use TargetType.PAGE etc.
            // when Jest supports ESM or the project migrates to a native-ESM test runner.
            case "page":
            case "webview":
            case "background_page": {
              logger(`Target created`, target.type());
              const page = await target.page();
              if (!page) {
                logger(`No page found for target, unexpected`);
                return;
              }

              page.on(
                "framenavigated",
                runInLoggerContext((frame) => {
                  logger(`Frame navigated: ${frame.url()}`);
                  const { hostname, pathname } = new URL(page.url());
                  addToKeyedSet(pagesByCompany, companyId, hostname + pathname);
                }, context),
              );

              const canIntercept = rules.hasAnyRule();
              if (canIntercept) {
                logger(`Setting request interception`);
                await page.setRequestInterception(true);
              }

              page.on(
                "request",
                runInLoggerContext(async (request) => {
                  const url = new URL(request.url());
                  const pageUrl = new URL(page.url());
                  const hostname = url.hostname;
                  const reqKey = `${request.method()} ${hostname}`;

                  if (!resourceTypesByCompany.has(reqKey)) {
                    resourceTypesByCompany.set(reqKey, new Map());
                  }

                  const resourceType = request.resourceType();
                  addToKeyedSet(
                    resourceTypesByCompany.get(reqKey)!,
                    companyId,
                    resourceType,
                  );

                  if (canIntercept) {
                    if (request.isInterceptResolutionHandled()) {
                      logger(
                        `Request already handled ${reqKey} ${resourceType}`,
                      );
                    }
                    if (!(ignoreUrl(hostname) || !rules.isBlocked(url))) {
                      addToKeyedSet(blockedByCompany, companyId, reqKey);
                      logger(`Blocking ${pageUrl.hostname}->${reqKey}`);
                      await request.abort(undefined, 100);
                      return;
                    }
                  }

                  addToKeyedSet(allowedByCompany, companyId, reqKey);
                  if (canIntercept) {
                    await request.continue(undefined, 100);
                  }
                }, context),
              );

              break;
            }
            default:
              break;
          }
        }, context),
      );
    }
  }

  function ignoreUrl(url: string): boolean {
    return url === "about:blank" || url === "" || url === "invalid";
  }

  async function getUsedDomains(): Promise<UsedDomains> {
    const allCompanies = new Set([
      ...allowedByCompany.keys(),
      ...blockedByCompany.keys(),
    ]);
    if (allCompanies.size === 0 && domainsFromNode.size === 0) {
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
    const nodeDomains = Object.fromEntries(
      Array.from(domainsFromNode.entries()).map(([context, domains]) => [
        context,
        Array.from(domains),
      ]),
    );
    return {
      ...domainsRecord,
      node: nodeDomains,
    };
  }

  return tracker;
}

export function mergeUsedDomains(...records: UsedDomains[]): UsedDomains {
  const merged = new Map<string, Map<string, string[]>>();
  for (const record of records) {
    for (const [company, categories] of Object.entries(record)) {
      const target = merged.get(company) ?? new Map<string, string[]>();
      merged.set(company, target);
      for (const [category, requests] of Object.entries(categories)) {
        target.set(
          category,
          Array.from(new Set([...(target.get(category) ?? []), ...requests])),
        );
      }
    }
  }
  return Object.fromEntries(
    Array.from(merged, ([company, categories]) => [
      company,
      Object.fromEntries(categories),
    ]),
  );
}
