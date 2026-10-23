import { Scheduler, nextRunTime, parseTimeOfDay } from "./scheduler.js";

describe("scheduler", () => {
  describe("parseTimeOfDay", () => {
    it("parses a 24 hour time", () => {
      expect(parseTimeOfDay("09:05")).toEqual({ hours: 9, minutes: 5 });
      expect(parseTimeOfDay("00:00")).toEqual({ hours: 0, minutes: 0 });
      expect(parseTimeOfDay("23:59")).toEqual({ hours: 23, minutes: 59 });
    });

    it("rejects anything that is not HH:mm", () => {
      for (const invalid of [
        "9:00",
        "24:00",
        "09:60",
        "09:00:00",
        "",
        "nope",
      ]) {
        expect(() => parseTimeOfDay(invalid)).toThrow(
          `Invalid time of day: ${invalid}`,
        );
      }
    });
  });

  describe("nextRunTime", () => {
    it("returns the next occurrence today when the time is still ahead", () => {
      const from = new Date("2026-03-01T08:00:00");
      expect(nextRunTime(["09:00"], from)).toEqual(
        new Date("2026-03-01T09:00:00"),
      );
    });

    it("returns tomorrow when the time already passed", () => {
      const from = new Date("2026-03-01T10:00:00");
      expect(nextRunTime(["09:00"], from)).toEqual(
        new Date("2026-03-02T09:00:00"),
      );
    });

    it("is exclusive of the current moment", () => {
      const from = new Date("2026-03-01T09:00:00");
      expect(nextRunTime(["09:00"], from)).toEqual(
        new Date("2026-03-02T09:00:00"),
      );
    });

    it("picks the closest of several times", () => {
      const from = new Date("2026-03-01T08:00:00");
      expect(nextRunTime(["09:00", "21:00"], from)).toEqual(
        new Date("2026-03-01T09:00:00"),
      );
      expect(
        nextRunTime(["09:00", "21:00"], new Date("2026-03-01T10:00:00")),
      ).toEqual(new Date("2026-03-01T21:00:00"));
      expect(
        nextRunTime(["09:00", "21:00"], new Date("2026-03-01T22:00:00")),
      ).toEqual(new Date("2026-03-02T09:00:00"));
    });

    it("returns undefined when no times are configured", () => {
      expect(nextRunTime([], new Date("2026-03-01T08:00:00"))).toBeUndefined();
    });

    it("throws on an invalid time", () => {
      expect(() => nextRunTime(["nope"], new Date())).toThrow("Invalid time");
    });
  });

  describe("Scheduler", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-03-01T08:00:00"));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("runs at the configured time and re-arms for the next one", async () => {
      const run = jest.fn().mockResolvedValue(undefined);
      const scheduler = new Scheduler(["09:00"], run);

      scheduler.start();
      expect(scheduler.nextRunAt).toEqual(new Date("2026-03-01T09:00:00"));

      await jest.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(run).toHaveBeenCalledTimes(1);
      expect(scheduler.nextRunAt).toEqual(new Date("2026-03-02T09:00:00"));

      scheduler.stop();
    });

    it("keeps running after a failing run", async () => {
      const run = jest.fn().mockRejectedValue(new Error("boom"));
      const scheduler = new Scheduler(["09:00"], run);

      scheduler.start();
      await jest.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(scheduler.nextRunAt).toEqual(new Date("2026-03-02T09:00:00"));

      await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(run).toHaveBeenCalledTimes(2);

      scheduler.stop();
    });

    it("schedules nothing when no times are configured", async () => {
      const run = jest.fn().mockResolvedValue(undefined);
      const scheduler = new Scheduler([], run);

      scheduler.start();
      expect(scheduler.nextRunAt).toBeUndefined();

      await jest.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
      expect(run).not.toHaveBeenCalled();
    });

    it("does not run after being stopped", async () => {
      const run = jest.fn().mockResolvedValue(undefined);
      const scheduler = new Scheduler(["09:00"], run);

      scheduler.start();
      scheduler.stop();

      await jest.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);

      expect(run).not.toHaveBeenCalled();
      expect(scheduler.nextRunAt).toBeUndefined();
    });
  });
});
