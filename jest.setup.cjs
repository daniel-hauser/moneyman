// Jest does not currently fake node:timers/promises: https://github.com/jestjs/jest/issues/16392
jest.mock("node:timers/promises", () => {
  const actual = jest.requireActual("node:timers/promises");
  const { addAbortListener } = require("node:events");

  return {
    ...actual,
    setTimeout(delay, value, options) {
      const fake = globalThis.setTimeout.clock || globalThis.clearTimeout.clock;
      if (!fake) return actual.setTimeout(delay, value, options);

      const { signal, ref } = options ?? {};
      if (signal?.aborted) return actual.setTimeout(delay, value, options);
      const normalizedDelay =
        delay >= 1 && delay <= 2147483647 ? Math.trunc(delay) : 1;

      return new Promise((resolve, reject) => {
        const clear = globalThis.clearTimeout;
        let listener;
        const timer = globalThis.setTimeout(() => {
          listener?.[Symbol.dispose]();
          resolve(value);
        }, normalizedDelay);
        if (ref === false) timer?.unref?.();
        if (signal) {
          listener = addAbortListener(signal, () => {
            clear(timer);
            listener?.[Symbol.dispose]();
            actual.setTimeout(0, undefined, { signal }).catch(reject);
          });
        }
      });
    },
  };
});

jest.mock("./src/utils/logger.js", () => {
  const { BooleanEnvVarSchema } = jest.requireActual("./src/config.schema.js");
  const createMockLogger = () => {
    const log = jest.fn();
    log.extend = createMockLogger;
    return log;
  };

  return {
    logger: createMockLogger(),
    createLogger: createMockLogger,
    logToPublicLog: jest.fn(),
    unsafeStdout: BooleanEnvVarSchema.parse(process.env.MONEYMAN_UNSAFE_STDOUT),
  };
});
