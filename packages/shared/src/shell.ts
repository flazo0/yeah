/** Quotes a value for safe interpolation into a POSIX shell command (single-quote style). */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
