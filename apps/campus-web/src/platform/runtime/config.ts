export const CAMPUS_RUNTIME_CONFIG_SCRIPT_ID = "__CAMPUS_RUNTIME_CONFIG__";

export interface CampusRuntimeConfig {
	accountUrl: string;
	loginUrl: string;
	sentry: {
		dsn: string | null;
		environment: string | null;
		release: string | null;
	};
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
			loginUrl?: unknown;
			sentry?: unknown;
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

export function buildAccountLoginUrl(config: CampusRuntimeConfig, returnTo: string): string {
	const url = new URL(config.loginUrl);
	url.searchParams.set("redirectTo", returnTo);
	return url.toString();
}

export function buildAccountLoginUrlForCurrentRoute(): string {
	if (typeof window === "undefined") {
		throw new Error("Campus login return target is unavailable outside the browser.");
	}
	const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`;
	return buildAccountLoginUrl(getCampusRuntimeConfig(), returnTo);
}

function normalizeCampusRuntimeConfig(input: {
	accountUrl?: unknown;
	loginUrl?: unknown;
	sentry?: unknown;
}): CampusRuntimeConfig {
	const accountUrl = normalizeUrl(input.accountUrl);
	const loginUrl = normalizeUrl(input.loginUrl);
	if (!(accountUrl && loginUrl)) {
		throw new Error("Campus runtime config is invalid.");
	}
	return {
		accountUrl,
		loginUrl,
		sentry: normalizeSentryConfig(input.sentry),
	};
}

function normalizeSentryConfig(value: unknown): CampusRuntimeConfig["sentry"] {
	const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	return {
		dsn: normalizeOptionalString(input.dsn),
		environment: normalizeOptionalString(input.environment),
		release: normalizeOptionalString(input.release),
	};
}

function normalizeOptionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
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
