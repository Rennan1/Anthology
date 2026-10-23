/** `["routes", "code", "fallbacks", 1]` becomes `routes.code.fallbacks[1]`. */
export function formatJsonPath(segments: readonly PropertyKey[]): string {
  return segments.reduce<string>((path, segment) => {
    if (typeof segment === "number") return `${path}[${segment}]`;
    return path === "" ? String(segment) : `${path}.${String(segment)}`;
  }, "");
}
