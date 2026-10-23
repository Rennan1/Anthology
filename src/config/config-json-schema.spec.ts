import { readFileSync } from "node:fs";
import { buildConfigJsonSchema } from "./config-json-schema.js";

describe("anthology.config.schema.json", () => {
  it("matches the schema generated from the zod source (run `npm run schema:generate` on drift)", () => {
    const committed = JSON.parse(readFileSync("anthology.config.schema.json", "utf8"));

    expect(committed).toEqual(buildConfigJsonSchema());
  });
});
