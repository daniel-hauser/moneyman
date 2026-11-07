// Jest does not currently fake node:timers/promises: https://github.com/jestjs/jest/issues/16392
jest.mock("node:timers/promises", () => {
  const actual = jest.requireActual("node:timers/promises");
  const { addAbortListener } = require("node:events");
  const { promisify } = require("node:util");

  return {
    ...actual,
    setTimeout(delay, value, options) {
      const fake =
        globalThis.setTimeout.clock ||
        (jest.isMockFunction(globalThis.setTimeout) &&
          (globalThis.clearTimeout.clock ||
            Object.hasOwn(globalThis.setTimeout, promisify.custom)));
      if (!fake) return actual.setTimeout(delay, value, options);

      try {
        if (
          (delay !== undefined && typeof delay !== "number") ||
          (options !== undefined &&
            (options === null ||
              typeof options !== "object" ||
              Array.isArray(options))) ||
          (options?.signal !== undefined &&
            (options.signal === null ||
              typeof options.signal !== "object" ||
              !("aborted" in options.signal))) ||
          (options?.ref !== undefined && typeof options.ref !== "boolean")
        ) {
          return actual.setTimeout(delay, value, options);
        }

        const { signal, ref } = options ?? {};
        if (signal?.aborted) return actual.setTimeout(delay, value, options);

        return new Promise((resolve, reject) => {
          const clear = globalThis.clearTimeout;
          let listener;
          const timer = globalThis.setTimeout(() => {
            listener?.[Symbol.dispose]();
            resolve(value);
          }, delay);
          if (ref === false) timer?.unref?.();
          if (signal) {
            try {
              listener = addAbortListener(signal, () => {
                clear(timer);
                listener?.[Symbol.dispose]();
                actual.setTimeout(0, undefined, { signal }).catch(reject);
              });
            } catch (error) {
              clear(timer);
              reject(error);
            }
          }
        });
      } catch (error) {
        return Promise.reject(error);
      }
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
