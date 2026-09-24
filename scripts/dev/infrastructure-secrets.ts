import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { LocalDevProfile } from "./profile";

export interface LocalInfrastructureSecrets {
	objectStoreAccessKey: string;
	objectStoreSecretKey: string;
	postgresPassword: string;
	qdrantApiKey: string;
	qdrantReadOnlyApiKey: string;
	temporalPostgresPassword: string;
}

export function resolveLocalInfrastructureSecretsPath(
	repoRoot: string,
	profile: LocalDevProfile,
): string {
	return resolve(repoRoot, "var/dev/infrastructure", `${profile.instanceId}.env`);
}

export function ensureLocalInfrastructureSecrets(
	repoRoot: string,
	profile: LocalDevProfile,
): LocalInfrastructureSecrets {
	const path = resolveLocalInfrastructureSecretsPath(repoRoot, profile);
	const existing = readIfExists(path);
	const secrets: LocalInfrastructureSecrets = {
		objectStoreAccessKey: existing?.RUSTFS_ACCESS_KEY ?? randomToken(16),
		objectStoreSecretKey: existing?.RUSTFS_SECRET_KEY ?? randomToken(32),
		postgresPassword: existing?.POSTGRES_PASSWORD ?? randomToken(32),
		qdrantApiKey: existing?.QDRANT_API_KEY ?? randomToken(32),
		qdrantReadOnlyApiKey: existing?.QDRANT_READ_ONLY_API_KEY ?? randomToken(32),
		temporalPostgresPassword: existing?.TEMPORAL_POSTGRES_PASSWORD ?? randomToken(32),
	};
	const values = [
		`POSTGRES_PORT=${profile.infraPorts.postgres}`,
		`OBJECT_STORE_PORT=${profile.infraPorts.objectStore}`,
		`OBJECT_STORE_CONSOLE_PORT=${profile.infraPorts.objectStoreConsole}`,
		`TEMPORAL_PORT=${profile.infraPorts.temporal}`,
		`TEMPORAL_UI_PORT=${profile.infraPorts.temporalUi}`,
		`QDRANT_HTTP_PORT=${profile.infraPorts.qdrantHttp}`,
		`QDRANT_GRPC_PORT=${profile.infraPorts.qdrantGrpc}`,
		`RUSTFS_ACCESS_KEY=${secrets.objectStoreAccessKey}`,
		`RUSTFS_SECRET_KEY=${secrets.objectStoreSecretKey}`,
		`POSTGRES_PASSWORD=${secrets.postgresPassword}`,
		`TEMPORAL_POSTGRES_PASSWORD=${secrets.temporalPostgresPassword}`,
		`QDRANT_API_KEY=${secrets.qdrantApiKey}`,
		`QDRANT_READ_ONLY_API_KEY=${secrets.qdrantReadOnlyApiKey}`,
	].join("\n");
	if (!existing || readFileSync(path, "utf8") !== `${values}\n`) {
		mkdirSync(dirname(path), { recursive: true });
		const temporary = `${path}.${process.pid}.tmp`;
		writeFileSync(temporary, `${values}\n`, { mode: 0o600 });
		chmodSync(temporary, 0o600);
		renameSync(temporary, path);
	}
	return secrets;
}

export function loadLocalInfrastructureSecrets(
	repoRoot: string,
	profile: LocalDevProfile,
): LocalInfrastructureSecrets {
	const path = resolveLocalInfrastructureSecretsPath(repoRoot, profile);
	const values = readIfExists(path);
	if (
		!(
			values?.RUSTFS_ACCESS_KEY &&
			values.RUSTFS_SECRET_KEY &&
			values.POSTGRES_PASSWORD &&
			values.TEMPORAL_POSTGRES_PASSWORD &&
			values.QDRANT_API_KEY &&
			values.QDRANT_READ_ONLY_API_KEY
		)
	) {
		throw new Error(`Local infrastructure credentials are missing: ${path}`);
	}
	return {
		objectStoreAccessKey: values.RUSTFS_ACCESS_KEY,
		objectStoreSecretKey: values.RUSTFS_SECRET_KEY,
		postgresPassword: values.POSTGRES_PASSWORD,
		qdrantApiKey: values.QDRANT_API_KEY,
		qdrantReadOnlyApiKey: values.QDRANT_READ_ONLY_API_KEY,
		temporalPostgresPassword: values.TEMPORAL_POSTGRES_PASSWORD,
	};
}

export function removeLocalInfrastructureSecrets(repoRoot: string, profile: LocalDevProfile): void {
	const path = resolveLocalInfrastructureSecretsPath(repoRoot, profile);
	try {
		if (existsSync(path)) {
			writeFileSync(path, "", { mode: 0o600 });
		}
	} finally {
		try {
			renameSync(path, `${path}.removed`);
		} catch {
			// Cleanup is best effort; the instance registry remains authoritative on failure.
		}
	}
}

function readIfExists(path: string): Record<string, string> | undefined {
	if (!existsSync(path)) {
		return undefined;
	}
	const result: Record<string, string> = {};
	for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
		if (!line.trim()) {
			continue;
		}
		const index = line.indexOf("=");
		if (index > 0) {
			result[line.slice(0, index)] = line.slice(index + 1);
		}
	}
	return result;
}

function randomToken(bytes: number): string {
	return randomBytes(bytes).toString("base64url");
}
