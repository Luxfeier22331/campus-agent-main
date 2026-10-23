import { describe, expect, it, vi } from "vitest";

import { computeEmbeddingTargetSha256 } from "@campus-agent/embedding-runtime";

import { fetchNoticeEmbeddingConnection } from "../src/embedding.ts";

describe("notice embedding runtime config", () => {
	it("reads the existing canonical embedding configuration", async () => {
		const targetSha256 = computeEmbeddingTargetSha256("https://embedding.example/v1");
		const fetchMock = vi.fn<typeof fetch>(async (input) => {
			expect(String(input)).toBe(
				"http://model-config.test/internal/model-configs/campus_docs_embedding",
			);
			return Response.json({
				api_key: "secret",
				api_protocol: "openai.embeddings",
				base_url: "https://embedding.example/v1",
				model: "Qwen3-Embedding-4B",
				name: "campus_docs_embedding",
				provider: "openai-compatible",
				schema_version: "model_runtime_config.v1",
				target_sha256: targetSha256,
			});
		});

		await expect(
			fetchNoticeEmbeddingConnection(fetchMock, "http://model-config.test"),
		).resolves.toEqual({
			apiKey: "secret",
			baseUrl: "https://embedding.example/v1",
			model: "Qwen3-Embedding-4B",
			targetSha256,
		});
	});

	it("rejects a different model config slot", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () =>
			Response.json({
				api_key: "secret",
				api_protocol: "openai.embeddings",
				base_url: "https://embedding.example/v1",
				model: "Qwen3-Embedding-4B",
				name: "notice_embedding",
				provider: "openai-compatible",
				schema_version: "model_runtime_config.v1",
				target_sha256: "a".repeat(64),
			}),
		);

		await expect(
			fetchNoticeEmbeddingConnection(fetchMock, "http://model-config.test"),
		).rejects.toThrow("notice embedding model runtime config is invalid");
	});
});
