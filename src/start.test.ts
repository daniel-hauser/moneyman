const mockEntries: string[] = [];

jest.mock("./server.js", () => {
  mockEntries.push("server");
  return {};
});
jest.mock("./index.js", () => {
  mockEntries.push("index");
  return {};
});

describe("start", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  async function startWith(env: NodeJS.ProcessEnv) {
    mockEntries.length = 0;
    jest.resetModules();
    process.env = env;

    await import("./start.js");
    // The entry is loaded through a dynamic import, so let it settle
    await new Promise((resolve) => setImmediate(resolve));
  }

  it("starts the long running server when MONEYMAN_LONG_RUNNING is true", async () => {
    await startWith({ ...originalEnv, MONEYMAN_LONG_RUNNING: "true" });

    expect(mockEntries).toEqual(["server"]);
  });

  it("runs once when MONEYMAN_LONG_RUNNING is not set", async () => {
    const env = { ...originalEnv };
    delete env.MONEYMAN_LONG_RUNNING;

    await startWith(env);

    expect(mockEntries).toEqual(["index"]);
  });
});
