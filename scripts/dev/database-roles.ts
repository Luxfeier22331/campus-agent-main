import { LOCAL_DEV_DATABASE_PASSWORDS } from "./environment";
import { captureCommandResult, runCommand } from "./process";

export const POSTGRES_ADMIN_URL =
	"postgresql://postgres:postgres@127.0.0.1:5432/postgres?sslmode=disable";

export function ensureSharedDatabaseRoles(): void {
	const roles = [
		["campus_agent", LOCAL_DEV_DATABASE_PASSWORDS.owner],
		["product_data_ro", "local-product-data-ro"],
		["app_api", LOCAL_DEV_DATABASE_PASSWORDS.appApi],
		["execution_control", LOCAL_DEV_DATABASE_PASSWORDS.executionControl],
		["model_config", LOCAL_DEV_DATABASE_PASSWORDS.modelConfig],
		["ops_web", LOCAL_DEV_DATABASE_PASSWORDS.opsWeb],
		["notice_publisher", LOCAL_DEV_DATABASE_PASSWORDS.noticePublisher],
	] as const;
	for (const [name, password] of roles) {
		runPsql(
			`DO $role$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(name)}) THEN CREATE ROLE ${quoteIdentifier(name)} LOGIN PASSWORD ${quoteLiteral(password)}; ELSE ALTER ROLE ${quoteIdentifier(name)} LOGIN PASSWORD ${quoteLiteral(password)}; END IF; END $role$;`,
		);
	}
}

export function grantDatabaseConnect(databaseName: string): void {
	runPsql(
		[
			"app_api",
			"execution_control",
			"model_config",
			"ops_web",
			"notice_publisher",
			"product_data_ro",
		]
			.map(
				(role) =>
					`GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${quoteIdentifier(role)}`,
			)
			.join(";\n"),
	);
}

export function createLocalDatabase(databaseName: string): void {
	runPsql(
		`CREATE DATABASE ${quoteIdentifier(databaseName)} OWNER ${quoteIdentifier("campus_agent")};`,
	);
	runPsql(
		[
			`REVOKE ALL ON DATABASE ${quoteIdentifier(databaseName)} FROM PUBLIC`,
			...[
				"app_api",
				"execution_control",
				"model_config",
				"ops_web",
				"notice_publisher",
				"product_data_ro",
			].map(
				(role) =>
					`GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${quoteIdentifier(role)}`,
			),
		].join(";\n"),
	);
}

export function localDatabaseProbe(databaseName: string): "present" | "missing" | "unknown" {
	const result = captureCommandResult("psql", [
		POSTGRES_ADMIN_URL,
		"-At",
		"-v",
		"ON_ERROR_STOP=1",
		"-c",
		`SELECT 1 FROM pg_database WHERE datname = ${quoteLiteral(databaseName)};`,
	]);
	if (result.status !== 0 || result.error || result.timedOut) {
		return "unknown";
	}
	return result.stdout.trim() === "1" ? "present" : "missing";
}

export function runPsql(sql: string): void {
	runCommand("psql", [POSTGRES_ADMIN_URL, "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

export function quoteIdentifier(value: string): string {
	if (!/^[a-z_][a-z0-9_]*$/u.test(value)) {
		throw new Error(`Invalid PostgreSQL identifier: ${value}`);
	}
	return `"${value}"`;
}

function quoteLiteral(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}
