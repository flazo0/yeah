function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = n * 256 + Number(p);
  }
  return n;
}

function entryMatches(ip: string, entry: string): boolean {
  const [base, bits] = entry.split("/");
  if (bits === undefined) return ip === base;
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(base!);
  const len = Number(bits);
  if (a === null || b === null || !Number.isInteger(len) || len < 0 || len > 32) return false;
  if (len === 0) return true;
  const shift = 2 ** (32 - len);
  return Math.floor(a / shift) === Math.floor(b / shift);
}

function entries(list: string): string[] {
  return list.split(",").map((e) => e.trim()).filter(Boolean);
}

/** An entry is an exact IP (v4 or v6) or an IPv4 CIDR. */
export function isValidIpList(list: string): boolean {
  const parts = entries(list);
  return parts.length > 0 && parts.every((e) => {
    const [base, bits] = e.split("/");
    if (bits !== undefined) return ipv4ToInt(base!) !== null && /^\d{1,2}$/.test(bits) && Number(bits) <= 32;
    return /^[0-9a-fA-F:.]+$/.test(e) && (ipv4ToInt(e) !== null || e.includes(":"));
  });
}

/** null/empty allowlist = any address. */
export function ipAllowed(ip: string, list: string | null): boolean {
  if (!list) return true;
  return entries(list).some((e) => entryMatches(ip, e));
}
