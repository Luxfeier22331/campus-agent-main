import { describe, expect, it } from "vitest";
import {
	canonicalProjectionBytes,
	createProjection,
	parseProviderConfigProjection,
	projectionDigest,
} from "../src/index.ts";

const actor = { displayName: "Operator", principalId: "operator-1" };

const profile = {
	api_key: "secret",
	base_url: "https://provider.example/v1",
	kind: "prompt" as const,
	model: "model",
	profile_id: "profile-1",
	provider: "openai-compatible",
	revision: 1,
	role: "primary_agent" as const,
	timeout_ms: 30_000,
	transport: "responses",
};

describe("provider config projection", () => {
	it("creates deterministic canonical bytes", () => {
		const projection = createProjection({
			actor,
			now: new Date("2026-07-16T00:00:00.000Z"),
			profiles: { primary_agent: profile },
			publicationId: "publication-1",
		});
		expect(new TextDecoder().decode(canonicalProjectionBytes(projection))).toContain(
			'"schema_version":"provider_config_projection.v2"',
		);
		expect(projectionDigest(canonicalProjectionBytes(projection))).toMatch(
			/^sha256:[a-f0-9]{64}$/u,
		);
		expect(parseProviderConfigProjection(projection)).toEqual(projection);
	});

	it("rejects role mismatch and missing embedding dimensions", () => {
		expect(() =>
			createProjection({
				actor,
				profiles: { primary_agent: { ...profile, role: "hindsight_llm" } },
			}),
		).toThrow("role mismatch");
		expect(() =>
			createProjection({
				actor,
				profiles: {
					rag_query_embedding: { ...profile, kind: "embedding", role: "rag_query_embedding" },
				},
			}),
		).toThrow("requires dimensions");
	});

	it("rejects unknown fields and malformed profile content", () => {
		const projection = createProjection({ actor, profiles: { primary_agent: profile } });
		expect(() => parseProviderConfigProjection({ ...projection, legacy: true })).toThrow(
			"unexpected provider projection field",
		);
		expect(() =>
			parseProviderConfigProjection({
				...projection,
				profiles: { primary_agent: { ...profile, base_url: "http://provider.example" } },
			}),
		).toThrow("base_url must be HTTPS");
	});

	it("supports the RAG synthesis and reranker runtime roles", () => {
		const projection = createProjection({
			actor,
			profiles: {
				rag_reranker: {
					...profile,
					kind: "rerank",
					role: "rag_reranker",
					transport: "gitee_rerank",
				},
				rag_synthesis: { ...profile, role: "rag_synthesis" },
			},
		});
		expect(parseProviderConfigProjection(projection)).toEqual(projection);
	});
});
