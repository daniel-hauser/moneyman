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
      sendDeprecationMessage("removeEnvVars");

      expect(mockHandler).toHaveBeenCalledTimes(2);
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
      {
        messageId: "removeEnvVars",
        expectedContent: [
          "⚠️ Deprecation warning:",
          "old environment variables",
          "MONEYMAN_CONFIG",
          "SEND_NEW_CONFIG_TO_TG",
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
      sendDeprecationMessage("removeEnvVars");

      // Assign handler - should immediately process all pending
      assignDeprecationHandler(mockHandler);

      expect(mockHandler).toHaveBeenCalledTimes(2);
      expect(mockHandler).toHaveBeenCalledWith(
        "hashFiledChange",
        expect.stringContaining("⚠️ Deprecation warning:"),
      );
      expect(mockHandler).toHaveBeenCalledWith(
        "removeEnvVars",
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

  describe("integration scenarios", () => {
    it("should handle mixed pending and immediate deprecations", () => {
      const mockHandler = jest.fn();

      // Send some deprecations before handler
      sendDeprecationMessage("hashFiledChange");
      expect(mockHandler).not.toHaveBeenCalled();

      // Assign handler - should process pending
      assignDeprecationHandler(mockHandler);
      expect(mockHandler).toHaveBeenCalledTimes(1);

      // Send more after handler assigned - should be immediate
      sendDeprecationMessage("removeEnvVars");
      expect(mockHandler).toHaveBeenCalledTimes(2);

      // Duplicate should be ignored
      sendDeprecationMessage("hashFiledChange");
      expect(mockHandler).toHaveBeenCalledTimes(2); // Still 2
    });

    describe.each([
      { scenario: "before handler assignment", assignFirst: false },
      { scenario: "after handler assignment", assignFirst: true },
    ])("duplicate handling $scenario", ({ assignFirst }) => {
      it("should not process duplicate deprecations", () => {
        const mockHandler = jest.fn();

        if (assignFirst) {
          assignDeprecationHandler(mockHandler);
        }

        sendDeprecationMessage("hashFiledChange");
        sendDeprecationMessage("hashFiledChange");

        if (!assignFirst) {
          assignDeprecationHandler(mockHandler);
        }

        expect(mockHandler).toHaveBeenCalledTimes(1);
      });
    });
  });
});
