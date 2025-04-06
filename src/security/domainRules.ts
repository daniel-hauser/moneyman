import { CompanyTypes } from "israeli-bank-scrapers";
import { createLogger } from "../utils/logger.js";
import { addToKeyedMap } from "../utils/collections.js";

const logger = createLogger("domain-rules");
export type Rule = "ALLOW" | "BLOCK";

interface TrieNode {
  rules: Map<CompanyTypes, Rule>;
  children: Map<string, TrieNode>;
}

export class DomainRuleManager {
  private cachedRules = new Map<string, Map<CompanyTypes, Rule>>();
  private rootDomainTrie: TrieNode = { rules: new Map(), children: new Map() };

  /**
   * @param rulesString Domain rules string. Format: [company] [ALLOW/BLOCK] [domain]
   */
  public constructor(
    rulesString: string = process.env.FIREWALL_SETTINGS || "",
  ) {
    const rules = this.parseDomainRules(rulesString);
    for (const [companyId, action, domain] of rules) {
      this.insertRule(domain, companyId, action);
    }
  }

  private insertRule(domain: string, company: CompanyTypes, rule: Rule): void {
    // We store domains reversed in the trie (com.example.api) for efficient parent domain matching
    const parts = domain.split(".").reverse();
    let current = this.rootDomainTrie;

    for (const part of parts) {
      if (!current.children.has(part)) {
        current.children.set(part, { rules: new Map(), children: new Map() });
      }
      current = current.children.get(part)!;
    }

    current.rules.set(company, rule);
    logger(`Inserted rule: ${company} ${rule} ${domain}`);
  }

  /**
   * Check a URL against the domain rules for a specific company
   * @param url URL to check
   * @param company Company ID to check rules for
   * @returns "ALLOW" or "BLOCK" if a rule is found
   */
  getRule(url: URL | string, company: CompanyTypes): Rule {
    const defaultRule = process.env.BLOCK_BY_DEFAULT ? "BLOCK" : "ALLOW";
    const { hostname } = typeof url === "string" ? new URL(url) : url;
    if (!this.cachedRules.get(hostname)?.get(company)) {
      const rule = this.lookupRule(hostname, company);
      addToKeyedMap(this.cachedRules, hostname, [company, rule ?? defaultRule]);
    }

    return this.cachedRules.get(hostname)!.get(company)!;
  }

  isBlocked(url: URL | string, company: CompanyTypes): boolean {
    return this.getRule(url, company) === "BLOCK";
  }

  hasAnyRule(company: CompanyTypes): boolean {
    function hasRule({ rules, children }: TrieNode): boolean {
      return rules.has(company) || Array.from(children.values()).some(hasRule);
    }
    return hasRule(this.rootDomainTrie);
  }

  private lookupRule(domain: string, company: CompanyTypes): Rule | undefined {
    // We store domains reversed in the trie (com.example.api) for efficient parent domain matching
    const parts = domain.split(".").reverse();

    function findRule(node: TrieNode, index: number): Rule | undefined {
      const currentRule = node.rules.get(company);
      if (index >= parts.length || !node.children.has(parts[index])) {
        return currentRule;
      }
      const childNode = node.children.get(parts[index])!;
      const childRule = findRule(childNode, index + 1);
      return childRule ?? currentRule;
    }

    return findRule(this.rootDomainTrie, 0);
  }

  private parseDomainRules(rules: string): [CompanyTypes, Rule, string][] {
    return (
      rules
        // TODO: The split by pipe is undocumented, and is here to support one-line env vars with no comment support
        .split(/\n|\|/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => line.split(" ").filter((part) => part.trim()))
        .filter(
          (parts): parts is [string, string, string] => parts.length === 3,
        )
        .map(([companyId, action, domain]) => [
          companyId as CompanyTypes,
          action as Rule,
          domain,
        ])
    );
  }
}
