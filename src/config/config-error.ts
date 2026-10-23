export interface ConfigIssue {
  /** JSON path of the offending field, e.g. `routes.code.fallbacks[1]`. */
  readonly path: string;
  readonly message: string;
}

/** Boot-time failure (SPEC-002): lists every problem found, not only the first. */
export class ConfigError extends Error {
  constructor(readonly issues: readonly ConfigIssue[]) {
    super(
      `Invalid configuration (${issues.length} error${issues.length === 1 ? "" : "s"}):\n${issues
        .map((issue) => `  - ${issue.path || "(root)"}: ${issue.message}`)
        .join("\n")}`,
    );
    this.name = "ConfigError";
  }
}
