import type { ProductAvailabilityEnvironment } from "campus-contracts/product-availability";

import type { AvailabilityServiceDefinition, StatusRuntimeConfig } from "./types";

export const STATUS_EXPIRY_MS = 15 * 60_000;
export const STATUS_RETENTION_DAYS = 30;

export const CAMPUS_QA_DEFINITION: AvailabilityServiceDefinition = {
	capabilities: [],
	id: "campus.qa",
	name: "校园问答",
	shell: {
		bodyKind: "json",
		id: "campus-qa-availability",
		origin: "qa",
		path: "/api/chat/availability",
		serviceId: "campus.qa",
		validator: "chat_availability",
	},
};

export const CAMPUS_SERVICES_DEFINITION: AvailabilityServiceDefinition = {
	capabilities: [],
	id: "campus.services",
	name: "其他服务",
	shell: {
		bodyKind: "html",
		id: "campus-web-shell",
		origin: "campus",
		path: "/",
		serviceId: "campus.services",
		validator: "campus_html",
	},
};

export const STATUS_SERVICE_DEFINITIONS = [
	CAMPUS_QA_DEFINITION,
	CAMPUS_SERVICES_DEFINITION,
] as const;

export function resolveStatusEnvironment(
	value: string | undefined,
): ProductAvailabilityEnvironment {
	const normalized = value?.trim();
	if (!normalized || normalized === "development") {
		return "development";
	}
	if (normalized === "staging" || normalized === "production") {
		return normalized;
	}
	throw new Error(`Unsupported DEPLOYMENT_ENVIRONMENT: ${normalized}`);
}

export function resolveStatusRuntimeConfig(env: {
	DEPLOYMENT_ENVIRONMENT?: string;
	STATUS_CAMPUS_ORIGIN?: string;
	STATUS_QA_ORIGIN?: string;
}): StatusRuntimeConfig {
	const environment = resolveStatusEnvironment(env.DEPLOYMENT_ENVIRONMENT);
	const campusOrigin = resolveStatusOrigin(env.STATUS_CAMPUS_ORIGIN, environment);
	const qaOrigin = resolveStatusOrigin(env.STATUS_QA_ORIGIN, environment);
	if (!campusOrigin) {
		throw new Error("STATUS_CAMPUS_ORIGIN must be a valid origin for the deployment environment.");
	}
	if (!qaOrigin) {
		throw new Error("STATUS_QA_ORIGIN must be a valid origin for the deployment environment.");
	}
	return {
		campusOrigin,
		environment,
		expiresInMs: STATUS_EXPIRY_MS,
		qaOrigin,
		retentionDays: STATUS_RETENTION_DAYS,
	};
}

export function resolveStatusOrigin(
	value: string | undefined,
	environment: ProductAvailabilityEnvironment,
): string | null {
	if (!value?.trim()) {
		return null;
	}
	try {
		const url = new URL(value.trim());
		if (
			(url.protocol !== "http:" && url.protocol !== "https:") ||
			url.pathname !== "/" ||
			url.search ||
			url.hash ||
			url.username ||
			url.password ||
			(environment !== "development" && url.protocol !== "https:")
		) {
			return null;
		}
		return url.toString();
	} catch {
		return null;
	}
}

export function missingStatusRuntimeConfig(env: {
	ASSETS?: unknown;
	CAMPUS_WEB_PUBLIC_ORIGIN?: string;
	DEPLOYMENT_ENVIRONMENT?: string;
	STATUS_CAMPUS_ORIGIN?: string;
	STATUS_QA_ORIGIN?: string;
	STATUS_SNAPSHOT?: unknown;
}): string[] {
	const missing: string[] = [];
	let environment: ProductAvailabilityEnvironment | null = null;
	if (env.DEPLOYMENT_ENVIRONMENT?.trim()) {
		try {
			environment = resolveStatusEnvironment(env.DEPLOYMENT_ENVIRONMENT);
		} catch {
			missing.push("DEPLOYMENT_ENVIRONMENT");
		}
	} else {
		missing.push("DEPLOYMENT_ENVIRONMENT");
	}
	if (!env.ASSETS) {
		missing.push("ASSETS binding");
	}
	if (!resolveStatusOrigin(env.STATUS_CAMPUS_ORIGIN, environment ?? "development")) {
		missing.push("STATUS_CAMPUS_ORIGIN");
	}
	if (!resolveStatusOrigin(env.STATUS_QA_ORIGIN, environment ?? "development")) {
		missing.push("STATUS_QA_ORIGIN");
	}
	if (!resolveStatusOrigin(env.CAMPUS_WEB_PUBLIC_ORIGIN, environment ?? "development")) {
		missing.push("CAMPUS_WEB_PUBLIC_ORIGIN");
	}
	if (environment && environment !== "development" && !env.STATUS_SNAPSHOT) {
		missing.push("STATUS_SNAPSHOT binding");
	}
	return missing;
}

export function serviceProbes(definition: AvailabilityServiceDefinition) {
	return [definition.shell, ...definition.capabilities.flatMap((capability) => capability.probes)];
}
