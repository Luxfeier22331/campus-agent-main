import { type AccountAuthReturnOrigins, resolveAccountAuthReturnOrigins } from "./return-target";

export const AUTH_RUNTIME_CONFIG_SCRIPT_ID = "__CAMPUS_AUTH_CONFIG__";
export const DEFAULT_TURNSTILE_APPEARANCE = "interaction-only";
export const DEFAULT_TURNSTILE_EXECUTION = "render";

const TURNSTILE_APPEARANCES = ["always", "execute", "interaction-only"] as const;
const TURNSTILE_EXECUTIONS = ["render", "execute"] as const;

export type TurnstileAppearance = (typeof TURNSTILE_APPEARANCES)[number];
export type TurnstileExecution = (typeof TURNSTILE_EXECUTIONS)[number];

export interface TurnstileRuntimeConfig {
	authReturnOrigins: AccountAuthReturnOrigins;
	turnstileAppearance: TurnstileAppearance;
	turnstileExecution: TurnstileExecution;
	turnstileSiteKey: string | null;
}

function normalizeTurnstileSiteKey(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function normalizeTurnstileAppearance(value: unknown): TurnstileAppearance {
	return typeof value === "string" &&
		TURNSTILE_APPEARANCES.includes(value.trim() as TurnstileAppearance)
		? (value.trim() as TurnstileAppearance)
		: DEFAULT_TURNSTILE_APPEARANCE;
}

export function normalizeTurnstileExecution(value: unknown): TurnstileExecution {
	return typeof value === "string" &&
		TURNSTILE_EXECUTIONS.includes(value.trim() as TurnstileExecution)
		? (value.trim() as TurnstileExecution)
		: DEFAULT_TURNSTILE_EXECUTION;
}

export function resolveTurnstileRuntimeConfig(config: {
	publicCampusOrigin?: unknown;
	turnstileAppearance?: unknown;
	turnstileExecution?: unknown;
	turnstileSiteKey?: unknown;
}): TurnstileRuntimeConfig {
	return {
		authReturnOrigins: resolveAccountAuthReturnOrigins({
			publicCampusOrigin: config.publicCampusOrigin,
		}),
		turnstileAppearance: normalizeTurnstileAppearance(config.turnstileAppearance),
		turnstileExecution: normalizeTurnstileExecution(config.turnstileExecution),
		turnstileSiteKey: normalizeTurnstileSiteKey(config.turnstileSiteKey),
	};
}

export function parseTurnstileRuntimeConfigSource(
	source: string | null | undefined,
): TurnstileRuntimeConfig {
	if (!source?.trim()) {
		return resolveTurnstileRuntimeConfig({});
	}

	try {
		const parsed = JSON.parse(source) as {
			authReturnOrigins?: unknown;
			publicCampusOrigin?: unknown;
			turnstileAppearance?: unknown;
			turnstileExecution?: unknown;
			turnstileSiteKey?: unknown;
		};
		return {
			...resolveTurnstileRuntimeConfig(parsed),
			authReturnOrigins:
				parsed.authReturnOrigins &&
				typeof parsed.authReturnOrigins === "object" &&
				!Array.isArray(parsed.authReturnOrigins)
					? {
							...resolveAccountAuthReturnOrigins(parsed),
							...Object.fromEntries(
								Object.entries(parsed.authReturnOrigins).map(([key, value]) => [
									key,
									Array.isArray(value)
										? value
												.map((item) => (typeof item === "string" ? item.trim() : ""))
												.filter(Boolean)
										: [],
								]),
							),
						}
					: resolveAccountAuthReturnOrigins(parsed),
		};
	} catch {
		return resolveTurnstileRuntimeConfig({});
	}
}

export function readTurnstileRuntimeConfig(): TurnstileRuntimeConfig {
	if (typeof document === "undefined") {
		return parseTurnstileRuntimeConfigSource(null);
	}
	return parseTurnstileRuntimeConfigSource(
		document.getElementById(AUTH_RUNTIME_CONFIG_SCRIPT_ID)?.textContent,
	);
}
