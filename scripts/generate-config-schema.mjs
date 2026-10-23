// Gera anthology.config.schema.json a partir do schema zod (SPEC-002). Rode via `npm run schema:generate`.
import { writeFileSync } from "node:fs";
import { buildConfigJsonSchema } from "../dist/config/config-json-schema.js";

writeFileSync("anthology.config.schema.json", `${JSON.stringify(buildConfigJsonSchema(), null, 2)}\n`);
