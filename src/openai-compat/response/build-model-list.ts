import { AUTO_MODEL_ID } from "../../routing/gateway.types.js";

export interface Model {
  id: string;
  object: "model";
  created: number;
  owned_by: "anthology";
}

export interface ModelList {
  object: "list";
  data: Model[];
}

export function buildModel(id: string, created: number): Model {
  return { id, object: "model", created, owned_by: "anthology" };
}

export function buildModelList(routeIds: readonly string[], created: number): ModelList {
  return {
    object: "list",
    data: [AUTO_MODEL_ID, ...routeIds].map((id) => buildModel(id, created)),
  };
}
