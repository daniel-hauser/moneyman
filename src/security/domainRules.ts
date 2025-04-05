import { CompanyTypes } from "israeli-bank-scrapers";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("domain-rules");

export type Rule = "ALLOW" | "BLOCK" | "DEFAULT";

export interface DomainRuleManager {
  getRule: (url: URL | string, company: CompanyTypes) => Rule;
}

interface TrieNode {
  rules: Map<CompanyTypes, Rule>;
  children: Map<string, TrieNode>;
}

/**
 * Load domain rules
 * Format: [company] [ALLOW/BLOCK] [domain]
 * @returns A DomainRuleManager object with methods to check rules
 */
export function loadDomainRules(
  rulesString: string = process.env.FIREWALL_SETTINGS || "",
): DomainRuleManager {
  const domainTrie: TrieNode = {
    rules: new Map(),
    children: new Map(),
  };

  /**
   * Insert a domain rule into the trie
   */
  function insertRule(domain: string, company: CompanyTypes, rule: Rule): void {
    // We store domains reversed in the trie (com.example.api) for efficient parent domain matching
    const parts = domain.split(".").reverse();
    let current = domainTrie;

    for (const part of parts) {
      if (!current.children.has(part)) {
        current.children.set(part, { rules: new Map(), children: new Map() });
      }
      current = current.children.get(part)!;
    }

    // Set rule at the leaf node
    current.rules.set(company, rule);
    logger(`Inserted rule: ${company} ${rule} ${domain}`);
  }

  /**
   * Look up a rule for a domain and company in the trie
   * Returns the rule if found, or null for default behavior (allow)
   */
  function lookupRule(domain: string, company: CompanyTypes): Rule {
    // We store domains reversed in the trie (com.example.api)
    const parts = domain.split(".").reverse();

    // Recursive function to traverse the trie and find the most specific rule
    function findRule(node: TrieNode, index: number): Rule | null {
      // Check if current node has a rule for this company
      const currentRule = node.rules.get(company) ?? null;
      if (index >= parts.length || !node.children.has(parts[index])) {
        return currentRule;
      }

      // Go deeper in the trie
      const childNode = node.children.get(parts[index])!;
      const childRule = findRule(childNode, index + 1);

      return childRule ?? currentRule;
    }

    return findRule(domainTrie, 0) ?? "DEFAULT";
  }

  for (const [companyId, action, domain] of parseDomainRules(rulesString)) {
    if (action === "ALLOW" || action === "BLOCK" || action === "DEFAULT") {
      insertRule(domain, companyId, action);
    }
  }

  return {
    /**
     * Check a URL against the domain rules for a specific company
     * @param url URL to check
     * @param company Company ID to check rules for
     * @returns "ALLOW" or "BLOCK" if a rule is found, "DEFAULT" if no rule exists
     */
    getRule: (url: URL | string, company: CompanyTypes): Rule => {
      const { hostname } = typeof url === "string" ? new URL(url) : url;
      const rule = lookupRule(hostname, company);
      return rule;
    },
  };
}

function parseDomainRules(rulesString: string): [CompanyTypes, Rule, string][] {
  return rulesString
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(" ").filter((part) => part.trim()))
    .filter((parts): parts is [string, string, string] => parts.length === 3)
    .map(([companyId, action, domain]) => [
      companyId as CompanyTypes,
      action as Rule,
      domain,
    ]);
}
