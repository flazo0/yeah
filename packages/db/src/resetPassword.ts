import { createDb } from "./client";
import { generateRecoveryPassword, parseResetArgs, resetUserPassword } from "./passwordReset";

// yeah reset-password [email] [--disable-2fa]      (YEAH_NEW_PASSWORD=... to choose the password; otherwise one is generated)
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const args = parseResetArgs(process.argv.slice(2), process.env);
if (args.error) {
  console.error(`${args.error}\nusage: yeah reset-password [email] [--disable-2fa]`);
  process.exit(2);
}
const generated = args.password === null;
const password = args.password ?? generateRecoveryPassword();
const result = await resetUserPassword(createDb(url), { email: args.email, password, disable2fa: args.disable2fa });
if (!result.ok) {
  console.error(`could not reset the password: ${result.error}`);
  process.exit(1);
}
console.log(`password reset for ${result.email}; ${result.sessionsEnded} open session(s) signed out${result.twoFactorDisabled ? "; two-factor authentication turned off" : ""}.`);
if (generated) console.log(`\nNew password (shown once, change it in Settings after signing in):\n\n  ${password}\n`);
process.exit(0);
