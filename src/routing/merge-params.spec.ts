import { testConfig } from "../../test/support/config-fixture.js";
import { mergeParams } from "./merge-params.js";

const config = testConfig((c) => {
  c.models.sonnet.defaults = { temperature: 0.2, topP: 0.5 };
  c.models.sonnet.maxOutputTokens = 16000;
  c.routes.code.defaults = { temperature: 0.4 };
  c.routes.general.enforce = { maxOutputTokens: 4000 };
});
const { sonnet, mini } = config.models;
const { code, summarize, general } = config.routes;
if (!sonnet || !mini || !code || !summarize || !general) throw new Error("fixture");

describe("mergeParams (SPEC-003: model defaults < route defaults < request < route enforce)", () => {
  it("lets the request beat the model default", () => {
    const params = mergeParams({ model: sonnet, route: summarize, request: { temperature: 0.9 } });

    expect(params.temperature).toBe(0.9);
  });

  it("lets route defaults beat model defaults, and keeps untouched model defaults", () => {
    const params = mergeParams({ model: sonnet, route: code, request: {} });

    expect(params).toEqual({ temperature: 0.4, topP: 0.5 });
  });

  it("lets route enforce beat the request", () => {
    const params = mergeParams({
      model: mini,
      route: general,
      request: { maxOutputTokens: 10000 },
    });

    expect(params.maxOutputTokens).toBe(4000);
  });

  it("caps maxOutputTokens at the model ceiling, after the merge", () => {
    const params = mergeParams({
      model: sonnet,
      route: summarize,
      request: { maxOutputTokens: 99999 },
    });

    expect(params.maxOutputTokens).toBe(16000);
  });

  it("does not invent maxOutputTokens: a ceiling limits a requested value, it is not a default", () => {
    const params = mergeParams({ model: mini, route: summarize, request: {} });

    expect(params).toEqual({ temperature: 0 });
  });

  it("is recomputed per model: the fallback keeps its own defaults and ceiling", () => {
    const request = { maxOutputTokens: 20000 };

    expect(mergeParams({ model: sonnet, route: code, request }).maxOutputTokens).toBe(16000);
    expect(mergeParams({ model: mini, route: code, request }).maxOutputTokens).toBe(20000);
  });

  it("renames stop to the AI SDK stopSequences", () => {
    const params = mergeParams({ model: mini, route: summarize, request: { stop: ["END"] } });

    expect(params.stopSequences).toEqual(["END"]);
    expect(params).not.toHaveProperty("stop");
  });
});
