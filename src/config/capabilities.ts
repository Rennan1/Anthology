/** Single source of the Capability list (config schema and routing filter derive from it). */
export const CAPABILITIES = ["tools", "vision", "json_schema"] as const;
export type Capability = (typeof CAPABILITIES)[number];
