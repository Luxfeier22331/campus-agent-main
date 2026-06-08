export const CAMPUS_RUNTIME_CONFIG_SCRIPT_ID = "__CAMPUS_RUNTIME_CONFIG__";

export interface CampusRuntimeConfig {
	accountUrl: string;
	loginReturnApp: "campus";
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
			loginReturnApp?: unknown;
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

export function buildHubLoginUrl(config: CampusRuntimeConfig, returnTo: string): string {
	const url = new URL(config.loginUrl);
	url.searchParams.set("return_app", config.loginReturnApp);
	url.searchParams.set("return_to", returnTo);
	return url.toString();
}

export function buildHubLoginUrlForCurrentRoute(): string {
	if (typeof window === "undefined") {
		throw new Error("Campus login return target is unavailable outside the browser.");
	}
	const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`;
	return buildHubLoginUrl(getCampusRuntimeConfig(), returnTo);
}

function normalizeCampusRuntimeConfig(input: {
	accountUrl?: unknown;
	loginReturnApp?: unknown;
	loginUrl?: unknown;
}): CampusRuntimeConfig {
	const accountUrl = normalizeUrl(input.accountUrl);
	const loginUrl = normalizeUrl(input.loginUrl);
	if (!(accountUrl && loginUrl && input.loginReturnApp === "campus")) {
		throw new Error("Campus runtime config is invalid.");
	}
	return {
		accountUrl,
		loginReturnApp: "campus",
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
