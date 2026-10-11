import { resolve } from "node:path";
import { parse, stringify } from "smol-toml";

export interface AppApiStagingResources {
	executionMaintenance?: boolean;
	hyperdriveId: string;
	objectStoreVpcServiceId: string;
	memoryServiceVpcServiceId: string;
	vpcServiceId: string;
}

export function buildAppApiStagingUploadSecrets(
	environment: Record<string, string | undefined>,
): Record<string, string> {
	const secrets: Record<string, string> = {};
	for (const name of [
		"APP_API_EXECUTION_SHARED_SECRET",
		"OBJECT_STORE_DERIVED_ACCESS_KEY",
		"OBJECT_STORE_DERIVED_SECRET_KEY",
		"OBJECT_STORE_DERIVED_READ_ACCESS_KEY",
		"OBJECT_STORE_DERIVED_READ_SECRET_KEY",
		"OPS_WEB_INTERNAL_TOKEN",
		"MEMORY_INTERNAL_SHARED_SECRET",
	]) {
		const value = environment[name]?.trim();
		if (!value) {
			throw new Error(`${name} is required for staging Worker version upload.`);
		}
		secrets[name] = value;
	}
	return secrets;
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
		staging.vpc_services,
		"MEMORY_SERVICE_PRIVATE",
		"service_id",
		requireUuid("MEMORY_SERVICE_VPC_SERVICE_ID", resources.memoryServiceVpcServiceId),
	);
	replaceBinding(
		staging.vpc_services,
		"OBJECT_STORE_PRIVATE",
		"service_id",
		requireUuid("OBJECT_STORE_VPC_SERVICE_ID", resources.objectStoreVpcServiceId),
	);
	replaceBinding(
		staging.hyperdrive,
		"APP_API_DB",
		"id",
		requireHyperdriveConfigurationId("APP_API_DB_HYPERDRIVE_ID", resources.hyperdriveId),
	);
	staging.vars = {
		...(staging.vars as Record<string, unknown>),
		EXECUTION_MAINTENANCE: String(resources.executionMaintenance ?? false),
	};
	config.main = resolve(appDir, "src/index.ts");
	return stringify(config);
}
