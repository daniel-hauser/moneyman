import { escapeMarkdownV2, escapeMessageForMarkdownV2 } from "./notifier.js";

describe("MarkdownV2 Escaping", () => {
  describe("escapeMarkdownV2", () => {
    it("should escape special characters", () => {
      const text = "4 transactions scraped.";
      const escaped = escapeMarkdownV2(text);
      expect(escaped).toBe("4 transactions scraped\\.");
    });

    it("should escape all special characters", () => {
      const text = "Text with _ * [ ] ( ) ~ ` > # + - = | { } . ! characters";
      const escaped = escapeMarkdownV2(text);
      expect(escaped).toBe("Text with \\_ \\* \\[ \\] \\( \\) \\~ \\` \\> \\# \\+ \\- \\= \\| \\{ \\} \\. \\! characters");
    });

    it("should handle account numbers with dots", () => {
      const text = "[bank] 123.456.789: 5";
      const escaped = escapeMarkdownV2(text);
      expect(escaped).toBe("\\[bank\\] 123\\.456\\.789: 5");
    });
  });

  describe("escapeMessageForMarkdownV2", () => {
    it("should preserve expandable block quotation syntax", () => {
      const message = "**>Successful Account Updates\n\t✔️ [bank] 12345: 5";
      const escaped = escapeMessageForMarkdownV2(message);
      expect(escaped).toBe("\\*\\*>Successful Account Updates\n\t✔️ \\[bank\\] 12345: 5");
    });

    it("should escape regular lines completely", () => {
      const message = "4 transactions scraped.\n(1 pending, 3 completed)";
      const escaped = escapeMessageForMarkdownV2(message);
      expect(escaped).toBe("4 transactions scraped\\.\n\\(1 pending, 3 completed\\)");
    });

    it("should handle mixed content with expandable blocks and regular text", () => {
      const message = `4 transactions scraped.

Accounts updated:
\t❌ [bank1] GENERIC
\t\tConnection failed
**>Successful Account Updates
\t✔️ [bank2] 12345: 5

Pending txns:
\t😶 None`;

      const escaped = escapeMessageForMarkdownV2(message);
      
      // The expandable block line should preserve **> but escape the rest
      expect(escaped).toContain("\\*\\*>Successful Account Updates");
      
      // Regular lines should be fully escaped
      expect(escaped).toContain("4 transactions scraped\\.");
      expect(escaped).toContain("\\[bank1\\]");
      expect(escaped).toContain("\\[bank2\\]");
    });
  });
});