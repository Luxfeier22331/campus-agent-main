import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");

function fail(message) {
  console.error(message);
  process.exit(1);
}

const managementDatabaseUrl = process.env.STAGING_APP_API_MANAGEMENT_DATABASE_URL?.trim();
if (!managementDatabaseUrl) {
  fail(
    "STAGING_APP_API_MANAGEMENT_DATABASE_URL is required. Point it at the staging shared Postgres management connection before running staging DB commands.",
  );
}

process.env.APP_API_MANAGEMENT_DATABASE_URL = managementDatabaseUrl;

const sslMode = process.env.STAGING_APP_API_DATABASE_SSLMODE?.trim();
if (sslMode) {
  process.env.APP_API_DATABASE_SSLMODE = sslMode;
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  fail("Usage: node ./scripts/run-with-staging-db-env.mjs <command> [args...]");
}

const child = spawn(command, args, {
  cwd: appDir,
  env: process.env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
