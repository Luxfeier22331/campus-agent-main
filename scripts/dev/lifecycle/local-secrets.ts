import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface LocalDevSecretsV3 {
	appApiSafetyIdentifierHmacSecret: string;
	betterAuthSecret: string;
	internalSharedSecret: string;
	edgeIngressSecret?: string;
	controlIngressSecret?: string;
	memoryInternalSecret?: string;
	opsWebInternalToken: string;
	schemaVersion: 3;
}

const LOCAL_SECRETS_RELATIVE_PATH = "var/dev/local-secrets.json";

type LocalDevSecretName = Exclude<keyof LocalDevSecretsV3, "schemaVersion">;

export function resolveLocalDevSecretsPath(repoRoot: string): string {
	return resolve(repoRoot, LOCAL_SECRETS_RELATIVE_PATH);
}

export function ensureLocalDevSecrets(
	repoRoot: string,
	candidates: Partial<Record<LocalDevSecretName, readonly (string | undefined)[]>> = {},
): LocalDevSecretsV3 {
	const path = resolveLocalDevSecretsPath(repoRoot);
	const existing = readLocalDevSecrets(path);
	const values = {} as Record<LocalDevSecretName, string>;
	for (const name of [
		"appApiSafetyIdentifierHmacSecret",
		"betterAuthSecret",
		"internalSharedSecret",
		"edgeIngressSecret",
		"controlIngressSecret",
		"memoryInternalSecret",
		"opsWebInternalToken",
	] as const) {
		const existingValue = existing?.[name];
		const candidateValues = (candidates[name] ?? []).filter((value): value is string =>
			Boolean(value?.trim()),
		);
		const unique = new Set([...(existingValue ? [existingValue] : []), ...candidateValues]);
		if (unique.size > 1) {
			throw new Error(`Conflicting local development secret: ${name}.`);
		}
		values[name] = [...unique][0] ?? randomSecret();
	}
	const next: LocalDevSecretsV3 = {
		...values,
		edgeIngressSecret: existing?.edgeIngressSecret ?? randomSecret(),
		controlIngressSecret: existing?.controlIngressSecret ?? randomSecret(),
		memoryInternalSecret: existing?.memoryInternalSecret ?? randomSecret(),
		schemaVersion: 3,
	};
	if (!existing || JSON.stringify(existing) !== JSON.stringify(next)) {
		writeJsonAtomic(path, next);
	}
	return next;
}

export function removeLocalDevSecrets(repoRoot: string): void {
	rmSync(resolveLocalDevSecretsPath(repoRoot), { force: true });
}

function readLocalDevSecrets(path: string): LocalDevSecretsV3 | null {
	if (!existsSync(path)) {
		return null;
	}
	const value = JSON.parse(readFileSync(path, "utf8")) as Partial<
		Omit<LocalDevSecretsV3, "schemaVersion">
	> & { schemaVersion?: number };
	if (
		value.schemaVersion !== 3 ||
		!nonEmpty(value.appApiSafetyIdentifierHmacSecret) ||
		!nonEmpty(value.betterAuthSecret) ||
		!nonEmpty(value.internalSharedSecret) ||
		!nonEmpty(value.opsWebInternalToken)
	) {
		throw new Error(`Invalid local development secrets: ${path}`);
	}
	return {
		...value,
		schemaVersion: 3,
	} as LocalDevSecretsV3;
}

function writeJsonAtomic(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${randomUUID()}.tmp`;
	writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporaryPath, path);
}

function randomSecret(): string {
	return randomBytes(32).toString("base64url");
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}
