export const AUTH_RUNTIME_CONFIG_SCRIPT_ID = "__PUBLIC_CHAT_AUTH_CONFIG__";
export const DEFAULT_TURNSTILE_APPEARANCE = "interaction-only";
export const DEFAULT_TURNSTILE_EXECUTION = "render";

const TURNSTILE_APPEARANCES = ["always", "execute", "interaction-only"] as const;
const TURNSTILE_EXECUTIONS = ["render", "execute"] as const;

export type TurnstileAppearance = (typeof TURNSTILE_APPEARANCES)[number];
export type TurnstileExecution = (typeof TURNSTILE_EXECUTIONS)[number];

export type TurnstileRuntimeConfig = {
	turnstileAppearance: TurnstileAppearance;
	turnstileExecution: TurnstileExecution;
	turnstileSiteKey: string | null;
};

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
	turnstileAppearance?: unknown;
	turnstileExecution?: unknown;
	turnstileSiteKey?: unknown;
}): TurnstileRuntimeConfig {
	return {
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
			turnstileAppearance?: unknown;
			turnstileExecution?: unknown;
			turnstileSiteKey?: unknown;
		};
		return resolveTurnstileRuntimeConfig(parsed);
	} catch {
		return resolveTurnstileRuntimeConfig({});
	}
}
