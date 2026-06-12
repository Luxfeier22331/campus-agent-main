import type { CapabilityExecutionResponse, RequestedScope } from "../src/modules/integration";

export const DEFAULT_SMOKE_EMAIL = "help_bot@outlook.com";
export const DEFAULT_SMOKE_NAME = "Campus Agent Smoke";

export interface RequestSmokeSeedArgs {
	email: string;
	name: string;
}

export interface RequestSmokeSeedScenario {
	conversationKey: string;
	key: string;
	prompt: string;
	requestedScope: RequestedScope | null;
	response: CapabilityExecutionResponse;
	status: CapabilityExecutionResponse["status"];
}

function normalizeOptionalValue(value: string | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

export function parseRequestSmokeSeedArgs(argv: string[]): RequestSmokeSeedArgs {
	let email = DEFAULT_SMOKE_EMAIL;
	let name = DEFAULT_SMOKE_NAME;

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--") {
			continue;
		}
		if (token === "--email") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--email requires a non-empty value.");
			}
			email = value.toLowerCase();
			index += 1;
			continue;
		}
		if (token === "--name") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--name requires a non-empty value.");
			}
			name = value;
			index += 1;
			continue;
		}

		throw new Error(`Unknown argument: ${token}`);
	}

	return {
		email,
		name,
	};
}
