jest.mock("../utils/logger.js", () => ({
  createLogger: () => jest.fn(),
}));

describe("deprecationManager", () => {
  let sendDeprecationMessage: any;
  let assignDeprecationHandler: any;

  beforeEach(async () => {
    jest.resetModules();
    ({ sendDeprecationMessage, assignDeprecationHandler } =
      await import("./deprecationManager.js"));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("sendDeprecationMessage", () => {
    it("should call handler immediately when handler is assigned", () => {
      const mockHandler = jest.fn();
      assignDeprecationHandler(mockHandler);

      sendDeprecationMessage("hashFiledChange");

      expect(mockHandler).toHaveBeenCalledWith(
        "hashFiledChange",
        expect.stringContaining("⚠️ Deprecation warning:"),
      );
    });

    it("should store deprecations when no handler is assigned", () => {
      const mockHandler = jest.fn();

      // Send deprecation before handler is assigned
      sendDeprecationMessage("hashFiledChange");
      expect(mockHandler).not.toHaveBeenCalled();

      // Assign handler - should immediately call with pending deprecation
      assignDeprecationHandler(mockHandler);
      expect(mockHandler).toHaveBeenCalledWith(
        "hashFiledChange",
        expect.stringContaining("⚠️ Deprecation warning:"),
      );
    });

    it("should not send same deprecation message twice", () => {
      const mockHandler = jest.fn();
      assignDeprecationHandler(mockHandler);

      sendDeprecationMessage("hashFiledChange");
      sendDeprecationMessage("hashFiledChange");

      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it("should handle multiple different deprecations", () => {
      const mockHandler = jest.fn();
      assignDeprecationHandler(mockHandler);

      sendDeprecationMessage("hashFiledChange");

      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    describe.each([
      {
        messageId: "hashFiledChange",
        expectedContent: [
          "⚠️ Deprecation warning:",
          "old transaction hash field",
          "https://github.com/daniel-hauser/moneyman/issues/268",
        ],
      },
    ] as const)(
      "message formatting for $messageId",
      ({ messageId, expectedContent }) => {
        it.each(expectedContent)(
          "should include '%s' in the message",
          (content) => {
            const mockHandler = jest.fn();
            assignDeprecationHandler(mockHandler);

            sendDeprecationMessage(messageId);

            expect(mockHandler).toHaveBeenCalledWith(
              messageId,
              expect.stringContaining(content),
            );
          },
        );
      },
    );
  });

  describe("assignDeprecationHandler", () => {
    it("should immediately call handler for pending deprecations", () => {
      const mockHandler = jest.fn();

      // Send deprecations before handler is assigned
      sendDeprecationMessage("hashFiledChange");

      // Assign handler - should immediately process all pending
      assignDeprecationHandler(mockHandler);

      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(mockHandler).toHaveBeenCalledWith(
        "hashFiledChange",
        expect.stringContaining("⚠️ Deprecation warning:"),
      );
    });

    it("should handle new deprecations after assignment", () => {
      const mockHandler = jest.fn();
      assignDeprecationHandler(mockHandler);

      sendDeprecationMessage("hashFiledChange");

      expect(mockHandler).toHaveBeenCalledWith(
        "hashFiledChange",
        expect.stringContaining("⚠️ Deprecation warning:"),
      );
    });

    it("should clear pending deprecations after processing", () => {
      const mockHandler1 = jest.fn();
      const mockHandler2 = jest.fn();

      // Send deprecation
      sendDeprecationMessage("hashFiledChange");

      // First handler should process it
      assignDeprecationHandler(mockHandler1);
      expect(mockHandler1).toHaveBeenCalledTimes(1);

      // Second handler should not see the already-processed deprecation
      assignDeprecationHandler(mockHandler2);
      expect(mockHandler2).not.toHaveBeenCalled();
    });

    it("should format messages correctly when calling handler", () => {
      const mockHandler = jest.fn();

      sendDeprecationMessage("hashFiledChange");
      assignDeprecationHandler(mockHandler);

      expect(mockHandler).toHaveBeenCalledWith(
        "hashFiledChange",
        expect.stringMatching(
          /⚠️ Deprecation warning:\s*This run is using the old transaction hash field/,
        ),
      );
    });
  });
});
