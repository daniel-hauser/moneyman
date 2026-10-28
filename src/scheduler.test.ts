import { Scheduler, toCronExpression } from "./scheduler.js";

type FakeTask = {
  expression: string;
  callback: () => unknown;
  getNextRun: jest.Mock;
  stop: jest.Mock;
};

const mockTasks: FakeTask[] = [];

jest.mock("node-cron", () => ({
  schedule: jest.fn((expression: string, callback: () => unknown) => {
    const task: FakeTask = {
      expression,
      callback,
      getNextRun: jest.fn(() => null),
      stop: jest.fn(),
    };
    mockTasks.push(task);
    return task;
  }),
}));

jest.mock("./utils/logger.js", () => ({ createLogger: () => jest.fn() }));

describe("toCronExpression", () => {
  it("maps a 24 hour time onto a daily cron expression", () => {
    expect(toCronExpression("09:05")).toBe("5 9 * * *");
    expect(toCronExpression("00:00")).toBe("0 0 * * *");
    expect(toCronExpression("23:59")).toBe("59 23 * * *");
  });

  it("rejects anything that is not HH:mm", () => {
    for (const invalid of ["9:00", "24:00", "09:60", "09:00:00", "", "nope"]) {
      expect(() => toCronExpression(invalid)).toThrow(
        `Invalid time of day: ${invalid}`,
      );
    }
  });
});

describe("Scheduler", () => {
  beforeEach(() => {
    mockTasks.length = 0;
  });

  it("schedules one cron task per configured time", () => {
    const scheduler = new Scheduler(["09:00", "21:30"], jest.fn());

    scheduler.start();

    expect(mockTasks.map((task) => task.expression)).toEqual([
      "0 9 * * *",
      "30 21 * * *",
    ]);
  });

  it("schedules nothing when no times are configured", () => {
    const scheduler = new Scheduler([], jest.fn());

    scheduler.start();

    expect(mockTasks).toHaveLength(0);
    expect(scheduler.nextRunAt).toBeUndefined();
  });

  it("reports the earliest next run of the tasks", () => {
    const scheduler = new Scheduler(["09:00", "21:30"], jest.fn());
    scheduler.start();

    const morning = new Date("2026-03-01T09:00:00");
    const evening = new Date("2026-03-01T21:30:00");
    // The order of the tasks is not the chronological order of their runs
    mockTasks[0].getNextRun.mockReturnValue(evening);
    mockTasks[1].getNextRun.mockReturnValue(morning);
    expect(scheduler.nextRunAt).toEqual(morning);

    mockTasks[1].getNextRun.mockReturnValue(null);
    expect(scheduler.nextRunAt).toEqual(evening);

    mockTasks[0].getNextRun.mockReturnValue(null);
    expect(scheduler.nextRunAt).toBeUndefined();
  });

  it("runs the scraper when a task fires", async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    const scheduler = new Scheduler(["09:00"], run);
    scheduler.start();

    await mockTasks[0].callback();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps running after a failing run", async () => {
    const run = jest.fn().mockRejectedValue(new Error("boom"));
    const scheduler = new Scheduler(["09:00"], run);
    scheduler.start();

    await expect(mockTasks[0].callback()).resolves.toBeUndefined();
  });

  it("stops every task and forgets them", () => {
    const scheduler = new Scheduler(["09:00", "21:30"], jest.fn());
    scheduler.start();

    scheduler.stop();

    expect(mockTasks[0].stop).toHaveBeenCalledTimes(1);
    expect(mockTasks[1].stop).toHaveBeenCalledTimes(1);
    expect(scheduler.nextRunAt).toBeUndefined();
  });
});
