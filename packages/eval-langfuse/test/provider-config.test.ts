import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadEvalProviderProjection, withRagasRuntimeConfig } from "../src/provider-config";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("eval provider projection", () => {
	it("materializes role-specific 0600 Ragas config and removes it after the call", () => {
		const projectionPath = writeProjection();
		let ragRuntimePath = "";
		withRagasRuntimeConfig({ kind: "rag", projectionPath }, (runtimeConfigPath) => {
			ragRuntimePath = runtimeConfigPath;
			expect(lstatSync(runtimeConfigPath).mode & 0o777).toBe(0o600);
			expect(JSON.parse(readFileSync(runtimeConfigPath, "utf-8"))).toEqual({
				embedding_api_key: "embedding-key",
				embedding_base_url: "https://embedding.example/v1",
				embedding_model: "embedding-model",
				llm_api_key: "ragas-key",
				llm_base_url: "https://provider.example/v1",
				llm_model: "ragas-model",
				schema_version: "ragas_runner_config.v1",
				timeout_seconds: 180,
			});
		});
		expect(existsSync(ragRuntimePath)).toBe(false);

		let agentRuntimePath = "";
		withRagasRuntimeConfig({ kind: "agent", projectionPath }, (runtimeConfigPath) => {
			agentRuntimePath = runtimeConfigPath;
			expect(JSON.parse(readFileSync(runtimeConfigPath, "utf-8"))).toMatchObject({
				llm_api_key: "judge-key",
				llm_model: "judge-model",
				schema_version: "ragas_runner_config.v1",
			});
		});
		expect(existsSync(agentRuntimePath)).toBe(false);
	});

	it("removes generated config when the runner throws", () => {
		const projectionPath = writeProjection();
		let runtimeConfigPath = "";
		expect(() =>
			withRagasRuntimeConfig({ kind: "rag", projectionPath }, (path) => {
				runtimeConfigPath = path;
				throw new Error("runner failed");
			}),
		).toThrow("runner failed");
		expect(existsSync(runtimeConfigPath)).toBe(false);
	});

	it("rejects permissive files and symbolic links", () => {
		const projectionPath = writeProjection();
		chmodSync(projectionPath, 0o640);
		expect(() => loadEvalProviderProjection(projectionPath)).toThrow("mode must be exactly 0600");

		chmodSync(projectionPath, 0o600);
		const linkPath = join(temporaryDirectories.at(-1) ?? "", "projection-link.json");
		symlinkSync(projectionPath, linkPath);
		expect(() => loadEvalProviderProjection(linkPath)).toThrow("open eval provider projection");
	});
});

function writeProjection(): string {
	const directory = mkdtempSync(join(tmpdir(), "eval-provider-projection-test-"));
	temporaryDirectories.push(directory);
	const path = join(directory, "projection.json");
	writeFileSync(
		path,
		JSON.stringify({
			profiles: {
				eval_judge_llm: {
					api_key: "judge-key",
					base_url: "https://provider.example/v1",
					model: "judge-model",
					provider: "openai",
					timeout_ms: 120_000,
					transport: "openai_responses",
				},
				eval_ragas_embedding: {
					api_key: "embedding-key",
					base_url: "https://embedding.example/v1",
					dimensions: 2560,
					model: "embedding-model",
					provider: "openai",
					timeout_ms: 180_000,
					transport: "openai_embeddings",
				},
				eval_ragas_llm: {
					api_key: "ragas-key",
					base_url: "https://provider.example/v1",
					model: "ragas-model",
					provider: "openai",
					timeout_ms: 150_000,
					transport: "openai_responses",
				},
			},
			schema_version: "provider_config_projection.v1",
		}),
		{ encoding: "utf-8", mode: 0o600 },
	);
	return path;
}
