import { resolve } from "node:path";
import { parse, stringify } from "smol-toml";

export function validateStatusStagingOrigin(value: string): string {
	return validatePublicOrigin(value, "STATUS_CAMPUS_ORIGIN");
}

export function validateStatusQaOrigin(value: string): string {
	return validatePublicOrigin(value, "STATUS_QA_ORIGIN");
}

export function validateCampusWebPublicOrigin(value: string): string {
	return validatePublicOrigin(value, "CAMPUS_WEB_PUBLIC_ORIGIN");
}

function validatePublicOrigin(value: string, name: string): string {
	const origin = new URL(value);
	if (origin.protocol !== "https:") {
		throw new Error(`${name} must use HTTPS in staging.`);
	}
	if (
		origin.pathname !== "/" ||
		origin.search ||
		origin.hash ||
		origin.username ||
		origin.password
	) {
		throw new Error(`${name} must contain only an HTTPS origin.`);
	}
	return origin.toString();
}

function requireKvNamespaceId(value: string): string {
	if (!/^[0-9a-f]{32}$/u.test(value)) {
		throw new Error("STATUS_SNAPSHOT_KV_ID must be a 32-character lowercase hexadecimal ID.");
	}
	return value;
}

export function buildStatusStagingUploadConfig(
	source: string,
	appDir: string,
	kvNamespaceId: string,
): string {
	const config = parse(source) as Record<string, unknown>;
	const environments = config.env as Record<string, unknown> | undefined;
	const staging = environments?.staging as Record<string, unknown> | undefined;
	if (!staging) {
		throw new Error("Missing status-web staging Worker configuration.");
	}
	const namespaces = staging.kv_namespaces;
	if (!Array.isArray(namespaces)) {
		throw new Error("Missing staging STATUS_SNAPSHOT KV binding.");
	}
	const binding = namespaces.find(
		(candidate) =>
			candidate &&
			typeof candidate === "object" &&
			(candidate as Record<string, unknown>).binding === "STATUS_SNAPSHOT",
	) as Record<string, unknown> | undefined;
	if (!binding) {
		throw new Error("Missing staging STATUS_SNAPSHOT KV binding.");
	}
	binding.id = requireKvNamespaceId(kvNamespaceId);
	config.main = resolve(appDir, "src/index.ts");
	const assets = config.assets as Record<string, unknown> | undefined;
	if (!assets || typeof assets.directory !== "string" || !assets.directory.trim()) {
		throw new Error("Missing status-web static assets directory.");
	}
	assets.directory = resolve(appDir, assets.directory);
	return stringify(config);
}
