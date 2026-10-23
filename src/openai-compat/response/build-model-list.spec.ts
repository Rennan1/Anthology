import { describe, expect, it } from "@jest/globals";
import { buildModel, buildModelList } from "./build-model-list.js";

describe("buildModelList", () => {
  it("lists only auto when there are no routes", () => {
    expect(buildModelList([], 1792627200)).toEqual({
      object: "list",
      data: [{ id: "auto", object: "model", created: 1792627200, owned_by: "anthology" }],
    });
  });

  it("puts auto first and keeps the routes in the given order", () => {
    const list = buildModelList(["code", "chat", "vision"], 1792627200);
    expect(list.data.map((model) => model.id)).toEqual(["auto", "code", "chat", "vision"]);
  });

  it("gives every item the OpenAI model shape with the given created", () => {
    const list = buildModelList(["code"], 7);
    expect(list.data[1]).toEqual({
      id: "code",
      object: "model",
      created: 7,
      owned_by: "anthology",
    });
  });
});

describe("buildModel", () => {
  it("builds a single model object", () => {
    expect(buildModel("code", 9)).toEqual({
      id: "code",
      object: "model",
      created: 9,
      owned_by: "anthology",
    });
  });
});
