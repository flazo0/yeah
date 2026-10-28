// Secret redaction for text that is stored or shown (deploy logs): every value of the app's environment
// variables is replaced by `***` when it appears literally. Short values are skipped — masking "true" or
// "3000" would corrupt ordinary log lines without hiding anything worth hiding.

export const REDACTED = "***";
const MIN_SECRET_LENGTH = 6;

/** Values worth masking, longest first so a value containing another is replaced whole. */
export function secretValues(values: string[]): string[] {
  const unique = new Set(values.map((v) => v.trim()).filter((v) => v.length >= MIN_SECRET_LENGTH));
  return [...unique].sort((a, b) => b.length - a.length);
}

export function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  return out;
}
