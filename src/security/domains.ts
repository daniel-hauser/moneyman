import { CompanyTypes } from "israeli-bank-scrapers";
import { createLogger } from "../utils/logger.js";
import {
  runInLoggerContext,
  loggerContextStore,
} from "../utils/asyncContext.js";
import { type BrowserContext, TargetType } from "puppeteer";
import { ClientRequestInterceptor } from "@mswjs/interceptors/ClientRequest";
import { DomainRuleManager } from "./domainRules.js";
import { addToKeyedSet } from "../utils/collections.js";
import { config } from "../config.js";

const { scraping: scrapingConfig, security: securityConfig } = config.options;
const logger = createLogger("domain-security");

type CompanyToSet = Map<CompanyTypes, Set<string>>;

const domainsFromNode: Map<string, Set<string>> = new Map();
const pagesByCompany: CompanyToSet = new Map();
const blockedByCompany: CompanyToSet = new Map();
const allowedByCompany: CompanyToSet = new Map();
const resourceTypesByCompany: Map<string, CompanyToSet> = new Map();

export function monitorNodeConnections() {
  if (scrapingConfig.domainTracking) {
    const interceptor = new ClientRequestInterceptor();
    interceptor.apply();
    interceptor.on(
      "request",
      runInLoggerContext(({ request }) => {
        logger(`Outgoing request: ${request.method} ${request.url}`);
        const { hostname } = new URL(request.url);
        const context = loggerContextStore.getStore() ?? { prefix: "node" };
        const reqKey = `${request.method} ${hostname}`;
        addToKeyedSet(domainsFromNode, context.prefix, reqKey);
      }),
    );
  }
}

export async function initDomainTracking(
  browserContext: BrowserContext,
  companyId: CompanyTypes,
): Promise<void> {
  if (scrapingConfig.domainTracking) {
    const context = loggerContextStore.getStore();

    const rules = new DomainRuleManager(
      companyId,
      securityConfig.firewallSettings ?? [],
      securityConfig.blockByDefault,
    );
    browserContext.on(
      "targetcreated",
      runInLoggerContext(async (target) => {
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
                    logger(`Request already handled ${reqKey} ${resourceType}`);
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

export async function getUsedDomains(): Promise<
  Partial<Record<CompanyTypes | "node", unknown>>
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
  const nodeDomains = Object.fromEntries(
    Array.from(domainsFromNode.entries()).map(([context, domains]) => [
      context,
      Array.from(domains),
    ]),
  );
  return { ...domainsRecord, node: nodeDomains };
}
