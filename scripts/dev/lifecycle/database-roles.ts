import { captureCommandResult, runCommand } from "./process";
import type { LocalDevProfile } from "./profile";

export const LOCAL_DATABASE_ROLES = [
	["memory_service", "campus-agent-local-memory"],
	["app_api", "campus-agent-local-app-api"],
	["campus_search", "campus-agent-local-campus-search"],
	["agent_control", "campus-agent-local-agent-control"],
	["model_config", "campus-agent-local-model-config"],
	["ops_web", "campus-agent-local-ops-web"],
	["notice_publisher", "campus-agent-local-notice-publisher"],
	["campus_agent", "campus-agent-local-owner"],
] as const;

const LOCAL_DATABASE_NOLOGIN_ROLES = ["product_data_ro"] as const;

export function localAdminDatabaseUrl(
	profile: LocalDevProfile,
	password: string,
	database = "postgres",
) {
	return `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${profile.infraPorts.postgres}/${database}?sslmode=disable`;
}

export function localDatabaseProbe(
	profile: LocalDevProfile,
	postgresPassword: string,
	databaseName = profile.databaseName,
): "present" | "missing" | "unknown" {
	const result = captureCommandResult("psql", [
		localAdminDatabaseUrl(profile, postgresPassword),
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

export function ensureLocalDatabase(profile: LocalDevProfile, postgresPassword: string): void {
	runPsql(
		profile,
		postgresPassword,
		[
			...LOCAL_DATABASE_ROLES.map(
				([name, password]) =>
					`DO $role$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(name)}) THEN CREATE ROLE ${quoteIdentifier(name)} LOGIN PASSWORD ${quoteLiteral(password)}; ELSE ALTER ROLE ${quoteIdentifier(name)} LOGIN PASSWORD ${quoteLiteral(password)}; END IF; END $role$;`,
			),
			...LOCAL_DATABASE_NOLOGIN_ROLES.map(
				(name) =>
					`DO $role$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(name)}) THEN CREATE ROLE ${quoteIdentifier(name)} NOLOGIN; ELSE ALTER ROLE ${quoteIdentifier(name)} NOLOGIN; END IF; END $role$;`,
			),
		].join("\n"),
	);
	if (localDatabaseProbe(profile, postgresPassword) === "missing") {
		runPsql(
			profile,
			postgresPassword,
			`CREATE DATABASE ${quoteIdentifier(profile.databaseName)} OWNER campus_agent;`,
		);
	}

	const memoryDatabase = `${profile.databaseName}_memory`;
	if (localDatabaseProbe(profile, postgresPassword, memoryDatabase) === "missing") {
		runPsql(
			profile,
			postgresPassword,
			`CREATE DATABASE ${quoteIdentifier(memoryDatabase)} OWNER memory_service;`,
		);
	}
	runPsql(
		profile,
		postgresPassword,
		`REVOKE ALL ON DATABASE ${quoteIdentifier(memoryDatabase)} FROM PUBLIC;`,
	);

	runPsql(
		profile,
		postgresPassword,
		[
			`REVOKE ALL ON DATABASE ${quoteIdentifier(profile.databaseName)} FROM PUBLIC`,
			// Product consumers get CONNECT from the schema migrations; only the
			// local-only notice_publisher role has no deployment counterpart.
			`GRANT CONNECT ON DATABASE ${quoteIdentifier(profile.databaseName)} TO notice_publisher`,
		].join(";\n"),
	);
}

export function runPsql(profile: LocalDevProfile, postgresPassword: string, sql: string): void {
	runCommand("psql", [
		localAdminDatabaseUrl(profile, postgresPassword),
		"-v",
		"ON_ERROR_STOP=1",
		"-c",
		sql,
	]);
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
