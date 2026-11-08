import { setTimeout } from "node:timers/promises";

jest.mock("node:timers/promises", () => ({
  setTimeout: jest.fn().mockResolvedValue("local override"),
}));

it("allows a test to deliberately override the timer module", async () => {
  await expect(setTimeout(1)).resolves.toBe("local override");
});
