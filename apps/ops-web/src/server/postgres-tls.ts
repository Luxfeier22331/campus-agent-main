import { readFileSync } from "node:fs";

const TLS_QUERY_PARAMETERS = new Set(["ssl", "sslcert", "sslkey", "sslmode", "sslrootcert"]);

export type PostgresSslConfig = false | { ca: string; rejectUnauthorized: true };

export class PostgresTlsConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PostgresTlsConfigurationError";
	}
}

export function resolvePostgresTlsConfig(input: {
	caCertPath?: string;
	databaseUrl: string;
	deploymentEnvironment?: string;
	nodeEnvironment?: string;
	sslMode?: string;
}): { connectionString: string; ssl: PostgresSslConfig } {
	assertNoTlsQueryParameters(input.databaseUrl);
	const sslMode = input.sslMode?.trim().toLowerCase() || "verify-full";
	if (sslMode === "disable") {
		if (!isLocalOrTestEnvironment(input.deploymentEnvironment, input.nodeEnvironment)) {
			throw new PostgresTlsConfigurationError(
				"PostgreSQL TLS may only be disabled for local development or tests.",
			);
		}
		return { connectionString: input.databaseUrl, ssl: false };
	}
	if (sslMode !== "verify-full") {
		throw new PostgresTlsConfigurationError(
			"OPS_WEB_DATABASE_SSLMODE must be verify-full or disable.",
		);
	}

	const caCertPath = input.caCertPath?.trim();
	if (!caCertPath) {
		throw new PostgresTlsConfigurationError(
			"OPS_WEB_DATABASE_CA_CERT_PATH is required when PostgreSQL TLS verification is enabled.",
		);
	}
	const ca = readFileSync(caCertPath, "utf8");
	if (!ca.trim()) {
		throw new PostgresTlsConfigurationError(
			"OPS_WEB_DATABASE_CA_CERT_PATH must contain a PostgreSQL CA certificate.",
		);
	}
	return {
		connectionString: input.databaseUrl,
		ssl: { ca, rejectUnauthorized: true },
	};
}

function assertNoTlsQueryParameters(databaseUrl: string): void {
	let parsed: URL;
	try {
		parsed = new URL(databaseUrl);
	} catch {
		throw new PostgresTlsConfigurationError("OPS_WEB_DATABASE_URL must be a valid URL.");
	}
	for (const key of parsed.searchParams.keys()) {
		if (TLS_QUERY_PARAMETERS.has(key.toLowerCase())) {
			throw new PostgresTlsConfigurationError(
				"OPS_WEB_DATABASE_URL must not include PostgreSQL TLS query parameters.",
			);
		}
	}
}

function isLocalOrTestEnvironment(
	deploymentEnvironment: string | undefined,
	nodeEnvironment: string | undefined,
): boolean {
	const deployment = deploymentEnvironment?.trim().toLowerCase();
	const node = nodeEnvironment?.trim().toLowerCase();
	if (deployment) {
		return deployment === "development" || deployment === "local";
	}
	return node === "test";
}
