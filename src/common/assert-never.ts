/** Ends an exhaustive `switch`: a new union member becomes a compile error, not a silent default. */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
