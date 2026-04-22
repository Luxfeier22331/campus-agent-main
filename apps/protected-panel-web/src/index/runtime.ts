import { getMissingAccessConfig } from "./access";
import type { Env } from "./types";

export function hasAppApiBridge(env: Env): boolean {
	return Boolean(
		env.APP_API &&
			env.PANEL_RUNTIME_API_BASE_URL?.trim() &&
			env.PANEL_APP_API_SHARED_SECRET?.trim(),
	);
}

export function getMissingRuntimeConfig(env: Env): string[] {
	const missing: string[] = [];

	if (!env.APP_API) {
		missing.push("APP_API binding");
	}
	if (!env.ASSETS) {
		missing.push("ASSETS binding");
	}
	if (!env.PANEL_RUNTIME_API_BASE_URL?.trim()) {
		missing.push("PANEL_RUNTIME_API_BASE_URL");
	}
	if (!env.PANEL_APP_API_SHARED_SECRET?.trim()) {
		missing.push("PANEL_APP_API_SHARED_SECRET");
	}
	missing.push(...getMissingAccessConfig(env));

	return missing;
}

export async function probeAppApiRuntime(env: Env): Promise<string | null> {
	if (!hasAppApiBridge(env)) {
		return "App API binding is not configured.";
	}
	const appApi = env.APP_API;
	if (!appApi) {
		return "App API binding is not configured.";
	}

	try {
		const response = await appApi.fetch(
			new Request(new URL("/readyz", env.PANEL_RUNTIME_API_BASE_URL).toString(), {
				method: "GET",
			}),
		);
		if (response.status !== 200) {
			return `app-api readyz returned ${response.status}`;
		}

		const payload = (await response.json().catch(() => null)) as { status?: unknown } | null;
		if (payload?.status !== "ready") {
			return "app-api readyz returned an invalid payload";
		}

		return null;
	} catch (error) {
		return error instanceof Error ? error.message : "app-api readyz probe failed";
	}
}
