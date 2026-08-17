import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildEvalDatasetManifest, buildLangfuseDatasetItems } from "../src/index";

const repoRoot = resolve(import.meta.dirname, "../../..");

describe("eval dataset manifest builder", () => {
	it("projects canonical agent and RAG cases into Langfuse dataset manifests", () => {
		const manifest = buildEvalDatasetManifest({
			assetRoot: resolve(repoRoot, "packages/eval-langfuse/assets"),
			sourceGitHead: "test-head",
		});

		expect(manifest).toMatchObject({
			schema_version: "langfuse_dataset_manifest.v2",
			source_git_head: "test-head",
		});
		expect((manifest.datasets as Array<{ name: string }>).map((dataset) => dataset.name)).toContain(
			"campus/rag/student_rules",
		);
		expect((manifest.datasets as Array<{ name: string }>).map((dataset) => dataset.name)).toContain(
			"campus/rag/institutional_rules",
		);
		expect((manifest.datasets as Array<{ name: string }>).map((dataset) => dataset.name)).toContain(
			"campus/rag/cross_target",
		);
		expect(manifest.datasets).toContainEqual(
			expect.objectContaining({
				kind: "agent_tool_eval",
				name: "campus/agent/routing",
				surface_key: "app-api.chat",
			}),
		);
		expect(JSON.stringify(manifest)).not.toContain("fixture_");
	});

	it("builds agent routing items with per-case tool argument modes", () => {
		const assetPath = resolve(
			repoRoot,
			"packages/eval-langfuse/assets/datasets/agent/routing/cases.v1.json",
		);
		const items = buildLangfuseDatasetItems({
			dataset: {
				collection: "routing",
				asset_path: assetPath,
				kind: "agent_tool_eval",
				name: "campus/agent/routing",
				slug: "agent-routing",
				surface_key: "app-api.chat",
			},
			assetHash: "asset-hash",
			assetPath,
			sourceGitHead: "test-head",
		});

		expect(items.find((item) => metadataCaseId(item) === "routing-direct-greeting")).toMatchObject({
			expectedOutput: { reference_tool_calls: [] },
			metadata: { argument_mode: "name_only" },
		});
		expect(
			items.find((item) => metadataCaseId(item) === "routing-campus-docs-student-rules"),
		).toMatchObject({
			expectedOutput: {
				expected_outcome: "answer",
				reference_tool_calls: [],
			},
			input: { query: "学生申请缓考需要满足什么条件？" },
			metadata: { argument_mode: "name_only" },
		});
	});

	it("builds one Langfuse item with answer and retrieval truth", () => {
		const assetPath = resolve(
			repoRoot,
			"packages/eval-langfuse/assets/datasets/rag/student_rules/cases.v1.json",
		);
		const items = buildLangfuseDatasetItems({
			dataset: {
				collection: "student_rules",
				asset_path: assetPath,
				kind: "rag_eval",
				name: "campus/rag/student_rules",
				slug: "rag-student-rules",
				surface_key: "rag/student_rules",
			},
			assetHash: "asset-hash",
			assetPath,
			sourceGitHead: "test-head",
		});
		const item = items.find(
			(candidate) => metadataCaseId(candidate) === "student-rules-medical-version",
		);
		const historyItem = items.find(
			(candidate) => metadataCaseId(candidate) === "student-rules-conversation-follow-up",
		);

		expect(item).toMatchObject({
			datasetName: "campus/rag/student_rules",
			expectedOutput: {
				expected_outcome: "answer",
				expected_document_scopes: ["student_rules"],
				metric_applicability: {
					context_recall: true,
				},
				reference_context_ids: ["handbook:synthetic-medical-policy"],
			},
			input: {
				case_id: "student-rules-medical-version",
				question: "示例学生医疗报销按什么办法办理？",
				surface_key: "rag/student_rules",
				user_input: "示例学生医疗报销按什么办法办理？",
			},
			metadata: {
				argument_mode: "name_only",
				case_id: "student-rules-medical-version",
				asset_hash: "asset-hash",
				source_git_head: "test-head",
				source_asset_path: assetPath,
			},
		});
		expect(JSON.stringify(item)).not.toContain("fixture_");
		expect(item?.expectedOutput).toHaveProperty("reference");
		expect(historyItem?.input).toMatchObject({
			setup_turns: ["请帮我查一下示例学位授予规定。"],
		});
	});
});

function metadataCaseId(item: { metadata?: unknown }): string | null {
	const metadata = item.metadata;
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
		return null;
	}
	const value = (metadata as Record<string, unknown>).case_id;
	return typeof value === "string" ? value : null;
}
