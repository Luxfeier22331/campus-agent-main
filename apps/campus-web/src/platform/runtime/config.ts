import { type EnvironmentLane, isEnvironmentLane } from "campus-contracts/environment-lanes";

export const CAMPUS_RUNTIME_CONFIG_SCRIPT_ID = "__CAMPUS_RUNTIME_CONFIG__";

export interface CampusRuntimeConfig {
	accountUrl: string;
	deploymentLane: EnvironmentLane | null;
	loginUrl: string;
}

export function parseCampusRuntimeConfigSource(
	source: string | null | undefined,
): CampusRuntimeConfig {
	if (!source?.trim()) {
		throw new Error("Campus runtime config is missing.");
	}

	try {
		const parsed = JSON.parse(source) as {
			accountUrl?: unknown;
			deploymentLane?: unknown;
			loginUrl?: unknown;
		};
		return normalizeCampusRuntimeConfig(parsed);
	} catch {
		throw new Error("Campus runtime config is invalid.");
	}
}

export function getCampusRuntimeConfig(): CampusRuntimeConfig {
	if (typeof document === "undefined") {
		throw new Error("Campus runtime config is unavailable outside the browser.");
	}
	const script = document.getElementById(CAMPUS_RUNTIME_CONFIG_SCRIPT_ID);
	return parseCampusRuntimeConfigSource(script?.textContent);
}

// Static pages such as Docs are served without injected config and report no lane.
export function readDeploymentLane(): EnvironmentLane | null {
	try {
		return getCampusRuntimeConfig().deploymentLane;
	} catch {
		return null;
	}
}

export function buildAccountLoginUrl(config: CampusRuntimeConfig, returnTo: string): string {
	const url = new URL(config.loginUrl);
	url.searchParams.set("redirectTo", returnTo);
	return url.toString();
}

function normalizeCampusRuntimeConfig(input: {
	accountUrl?: unknown;
	deploymentLane?: unknown;
	loginUrl?: unknown;
}): CampusRuntimeConfig {
	const accountUrl = normalizeUrl(input.accountUrl);
	const loginUrl = normalizeUrl(input.loginUrl);
	if (!(accountUrl && loginUrl)) {
		throw new Error("Campus runtime config is invalid.");
	}
	return {
		accountUrl,
		deploymentLane: isEnvironmentLane(input.deploymentLane) ? input.deploymentLane : null,
		loginUrl,
	};
}

function normalizeUrl(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	try {
		return new URL(value.trim()).toString();
	} catch {
		return null;
	}
}
