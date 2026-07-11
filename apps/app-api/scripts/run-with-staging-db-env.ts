import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { loadRepoStagingEnvFile } from "../../../scripts/deploy/lib/repo-env.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");

loadRepoStagingEnvFile(import.meta.url, "../../..");

function fail(message) {
	console.error(message);
	process.exit(1);
}

const operatorDatabaseUrl = process.env.STAGING_APP_API_OPERATOR_DATABASE_URL?.trim();
if (!operatorDatabaseUrl) {
	fail("STAGING_APP_API_OPERATOR_DATABASE_URL is required.");
}

process.env.APP_API_OPERATOR_DATABASE_URL = operatorDatabaseUrl;
process.env.APP_API_ENVIRONMENT = "staging";
process.env.DEPLOYMENT_ENVIRONMENT = "staging";
process.env.AUTH_SHELL_ORIGIN =
	process.env.AUTH_SHELL_ORIGIN?.trim() || "https://campus-staging.mucwiki-edge.link";

const postgresCaCertPath = process.env.STAGING_POSTGRES_CA_CERT_PATH?.trim();
if (postgresCaCertPath) {
	process.env.APP_API_DATABASE_CA_CERT_PATH = postgresCaCertPath;
	process.env.OPS_AUDIT_MAINTENANCE_DATABASE_CA_CERT_PATH = postgresCaCertPath;
	process.env.OPS_WEB_DATABASE_CA_CERT_PATH = postgresCaCertPath;
}

const sslMode = process.env.STAGING_APP_API_DATABASE_SSLMODE?.trim();
if (sslMode) {
	process.env.APP_API_DATABASE_SSLMODE = sslMode;
}

const opsWebDatabaseUrl = process.env.STAGING_OPS_WEB_DATABASE_URL?.trim();
if (opsWebDatabaseUrl) {
	process.env.OPS_WEB_DATABASE_URL = opsWebDatabaseUrl;
}

const opsWebSslMode = process.env.STAGING_OPS_WEB_DATABASE_SSLMODE?.trim();
if (opsWebSslMode) {
	process.env.OPS_WEB_DATABASE_SSLMODE = opsWebSslMode;
}

const auditMaintenanceDatabaseUrl = process.env.STAGING_OPS_AUDIT_MAINTENANCE_DATABASE_URL?.trim();
if (auditMaintenanceDatabaseUrl) {
	process.env.OPS_AUDIT_MAINTENANCE_DATABASE_URL = auditMaintenanceDatabaseUrl;
}

const auditMaintenanceSslMode = process.env.STAGING_OPS_AUDIT_MAINTENANCE_DATABASE_SSLMODE?.trim();
if (auditMaintenanceSslMode) {
	process.env.OPS_AUDIT_MAINTENANCE_DATABASE_SSLMODE = auditMaintenanceSslMode;
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
	fail("Usage: pnpm exec tsx ./scripts/run-with-staging-db-env.ts <command> [args...]");
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
