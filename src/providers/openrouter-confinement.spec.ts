import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Assembled so this file does not match its own search.
const PACKAGE = ["@openrouter", "ai-sdk-provider"].join("/");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("OpenRouter import confinement (SPEC-004 criterion 4)", () => {
  it("is imported only from src/providers/openrouter/", () => {
    const files = sourceFiles("src");
    const importers = files
      .filter((file) => readFileSync(file, "utf8").includes(PACKAGE))
      .map((file) => relative(".", file).split(sep).join("/"));

    expect(files.length).toBeGreaterThan(20); // the walk actually saw the tree
    expect(importers.length).toBeGreaterThan(0); // and found the legitimate importer
    expect(importers.every((file) => file.startsWith("src/providers/openrouter/"))).toBe(true);
  });
});
