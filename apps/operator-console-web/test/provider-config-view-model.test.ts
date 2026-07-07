import { describe, expect, it } from "vitest";
import type { ProviderConfigConnection } from "../src/panel/operations/provider-config/model";
import {
	buildConnectionCreatePayload,
	buildProfileCreatePayload,
	type ConnectionFormState,
	type ProfileFormState,
	searchTransportForConnection,
} from "../src/panel/operations/provider-config/view-model";

function connection(overrides: Partial<ProviderConfigConnection> = {}): ProviderConfigConnection {
	return {
		baseUrl: "https://provider.example/v1",
		connectionId: "provider_connection_search",
		createdAt: "2026-06-16T00:00:00.000Z",
		featureConfig: {},
		features: ["search"],
		provider: "perplexity",
		revision: 1,
		secretConfigured: true,
		secretLast4: "1234",
		updatedAt: "2026-06-16T00:00:00.000Z",
		...overrides,
	};
}

function searchProfileForm(connectionId: string): ProfileFormState {
	return {
		connectionId,
		dimensions: "2560",
		model: "search-model",
		role: "public_web_search",
		timeoutMs: "30000",
		transport: "perplexity_search",
	};
}

describe("provider config view model", () => {
	it("preserves admitted public web search provider identities in connection payloads", () => {
		const form: ConnectionFormState = {
			apiKey: "provider-key",
			baseUrl: "https://hub.linux.do",
			featurePreset: "search",
			provider: "perplexity_compatible",
		};

		expect(buildConnectionCreatePayload(form)).toMatchObject({
			baseUrl: "https://hub.linux.do",
			features: ["search"],
			provider: "perplexity_compatible",
		});
	});

	it.each([
		["perplexity", "perplexity_search"],
		["perplexity_compatible", "perplexity_search"],
		["openai", "openai_responses_web_search"],
		["gemini", "gemini_google_search"],
	])("maps %s public web search profiles to the admitted transport", (provider, transport) => {
		const selectedConnection = connection({ provider });
		const payload = buildProfileCreatePayload(searchProfileForm(selectedConnection.connectionId), [
			selectedConnection,
		]);

		expect(searchTransportForConnection(selectedConnection)).toBe(transport);
		expect(payload).toMatchObject({
			connectionId: selectedConnection.connectionId,
			kind: "search",
			role: "public_web_search",
			transport,
		});
	});
});
