import { stringField } from "./json";

export interface LangfuseSettings {
	baseUrl: string;
	publicKey: string;
	secretKey: string;
	timeoutSeconds?: number;
}

export function settingsFromEnv(
	input: { env?: NodeJS.ProcessEnv; timeoutSeconds?: number } = {},
): LangfuseSettings {
	const env = input.env ?? process.env;
	return {
		baseUrl: stringField(env.LANGFUSE_BASE_URL, "LANGFUSE_BASE_URL"),
		publicKey: stringField(env.LANGFUSE_PUBLIC_KEY, "LANGFUSE_PUBLIC_KEY"),
		secretKey: stringField(env.LANGFUSE_SECRET_KEY, "LANGFUSE_SECRET_KEY"),
		timeoutSeconds: input.timeoutSeconds ?? 10,
	};
}

export function assertCompleteSettings(settings: LangfuseSettings): void {
	const populated = [settings.baseUrl, settings.publicKey, settings.secretKey].map((value) =>
		Boolean(value.trim()),
	);
	if (populated.some(Boolean) && !populated.every(Boolean)) {
		throw new Error("Langfuse adapter requires base URL, public and secret keys");
	}
	if (!populated.every(Boolean)) {
		throw new Error("Langfuse adapter is disabled");
	}
	if ((settings.timeoutSeconds ?? 10) <= 0) {
		throw new Error("Langfuse adapter timeout_seconds must be greater than zero");
	}
}
