import { describe, expect, it } from "vitest";
import {
	buildConnectionCreatePayload,
	buildProfileCreatePayload,
	type ConnectionFormState,
	type ProfileFormState,
} from "../src/panel/operations/provider-config/view-model";

function profileForm(overrides: Partial<ProfileFormState> = {}): ProfileFormState {
	return {
		connectionId: "provider_connection_current",
		dimensions: "2560",
		model: "gpt-current",
		role: "primary_agent",
		timeoutMs: "30000",
		transport: "responses",
		...overrides,
	};
}

describe("provider config view model", () => {
	it("builds current provider connection payloads", () => {
		const form: ConnectionFormState = {
			apiKey: "provider-key",
			baseUrl: "https://provider.example/v1",
			featurePreset: "prompt_embedding",
			provider: "openai-compatible",
		};

		expect(buildConnectionCreatePayload(form)).toEqual({
			apiKey: "provider-key",
			baseUrl: "https://provider.example/v1",
			features: ["prompt", "embedding"],
			provider: "openai-compatible",
		});
	});

	it("builds primary agent prompt profiles", () => {
		expect(buildProfileCreatePayload(profileForm({ transport: "chat_completions" }))).toEqual({
			connectionId: "provider_connection_current",
			kind: "prompt",
			model: "gpt-current",
			role: "primary_agent",
			timeoutMs: 30000,
			transport: "chat_completions",
		});
	});

	it("forces embedding profiles onto the embeddings transport", () => {
		expect(
			buildProfileCreatePayload(
				profileForm({
					model: "embedding-current",
					role: "rag_query_embedding",
					transport: "responses",
				}),
			),
		).toEqual({
			connectionId: "provider_connection_current",
			dimensions: 2560,
			kind: "embedding",
			model: "embedding-current",
			role: "rag_query_embedding",
			timeoutMs: 30000,
			transport: "embeddings",
		});
	});
});
