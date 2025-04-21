import { Config } from "./schema.js";
import { z } from "zod";

describe("Config Schema", () => {
  it("should match snapshot for the full configuration schema", () => {
    const jsonSchema = z.toJSONSchema(Config);
    expect(jsonSchema).toMatchSnapshot();
  });
});
