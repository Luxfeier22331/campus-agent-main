import { resolve } from "node:path";
import { parse, stringify } from "smol-toml";

export interface AppApiStagingResources {
	hyperdriveId: string;
	freshHyperdriveId: string;
	vpcServiceId: string;
}

function requireUuid(name: string, value: string): string {
	if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value)) {
		throw new Error(`${name} must contain a Cloudflare resource UUID.`);
	}
	return value;
}

function requireHyperdriveConfigurationId(name: string, value: string): string {
	if (!/^[0-9a-f]{32}$/.test(value)) {
		throw new Error(
			`${name} must contain a 32-character lowercase hexadecimal Cloudflare Hyperdrive configuration ID.`,
		);
	}
	return value;
}

function replaceBinding(
	bindings: unknown,
	bindingName: string,
	field: "id" | "service_id",
	value: string,
): void {
	if (!Array.isArray(bindings)) {
		throw new Error(`Missing staging ${bindingName} binding.`);
	}
	const binding = bindings.find(
		(candidate) =>
			candidate &&
			typeof candidate === "object" &&
			(candidate as Record<string, unknown>).binding === bindingName,
	) as Record<string, unknown> | undefined;
	if (!binding) {
		throw new Error(`Missing staging ${bindingName} binding.`);
	}
	binding[field] = value;
}

export function buildAppApiStagingUploadConfig(
	source: string,
	appDir: string,
	resources: AppApiStagingResources,
): string {
	const config = parse(source) as Record<string, unknown>;
	const environments = config.env as Record<string, unknown> | undefined;
	const staging = environments?.staging as Record<string, unknown> | undefined;
	if (!staging) {
		throw new Error("Missing app-api staging Worker configuration.");
	}
	replaceBinding(
		staging.vpc_services,
		"EXECUTION_CONTROL_PRIVATE",
		"service_id",
		requireUuid("EXECUTION_CONTROL_VPC_SERVICE_ID", resources.vpcServiceId),
	);
	replaceBinding(
		staging.hyperdrive,
		"APP_API_DB",
		"id",
		requireHyperdriveConfigurationId("APP_API_DB_HYPERDRIVE_ID", resources.hyperdriveId),
	);
	replaceBinding(
		staging.hyperdrive,
		"APP_API_DB_FRESH",
		"id",
		requireHyperdriveConfigurationId("APP_API_DB_FRESH_HYPERDRIVE_ID", resources.freshHyperdriveId),
	);
	config.main = resolve(appDir, "src/index.ts");
	return stringify(config);
}
