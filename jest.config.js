// ESM nativo: o Nest 12 é ESM-only, então o Jest roda com --experimental-vm-modules (ver scripts do package.json).
const base = {
  preset: "ts-jest/presets/default-esm",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: { "^(.{1,2}/.*).js$": "$1" },
  transform: { "^.+.ts$": ["ts-jest", { useESM: true, tsconfig: "tsconfig.json" }] },
  testEnvironment: "node",
};

export default {
  projects: [
    { ...base, displayName: "unit", testMatch: ["<rootDir>/src/**/*.spec.ts"] },
    { ...base, displayName: "contract", testMatch: ["<rootDir>/test/contract/**/*.spec.ts"] },
  ],
};
