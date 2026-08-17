import { stableId } from "./identifiers";
import type { JsonObject } from "./json";
import type { LangfuseEvalClient } from "./langfuse-client";
import { createLangfuseEvalClient } from "./langfuse-client";
import { settingsFromEnv } from "./settings";

export const LEARNING_LOOP_CANDIDATE_DATASET = "online-answer/candidates";

export type ImprovementCategory =
	| "prompt_instruction_fix"
	| "retrieval_source_fix"
	| "tool_schema_or_description_fix"
	| "tool_admission_or_routing_fix"
	| "model_provider_or_latency_budget_fix"
	| "product_expectation_or_ui_fix";

export interface LearningLoopCandidate {
	category: ImprovementCategory;
	evidence: {
		budgetState?: "within_budget" | "warn" | "critical";
		budgetVersion?: string;
		cachedInputTokens: number;
		durationMs?: number;
		errorCode: string | null;
		failClosed: boolean | null;
		inputTokens: number;
		modelName: string | null;
		modelProvider: string | null;
		outputTokens: number;
		projectionLagMs: number | null;
		reasonCodes: readonly string[];
		stageField?: string;
		status: string;
		totalTokens: number;
		traceAvailable: boolean;
	};
	feedbackId: string | null;
	feedbackUpdatedAt: string | null;
	reason: string;
	requestId: string;
	source: "message_feedback" | "runtime_observation";
}

function requiredString(value: string, field: string): string {
	const normalized = value.trim();
	if (!normalized) {
		throw new Error(`${field} is required`);
	}
	return normalized;
}

export function buildLearningLoopCandidateDatasetItem(
	candidate: LearningLoopCandidate,
): JsonObject {
	const requestId = requiredString(candidate.requestId, "requestId");
	const sourceKey =
		candidate.feedbackId === null
			? runtimeObservationSourceKey(candidate, requestId)
			: requiredString(candidate.feedbackId, "feedbackId");
	return {
		datasetName: LEARNING_LOOP_CANDIDATE_DATASET,
		expectedOutput: null,
		id: stableId("learning-loop-candidate", requestId, sourceKey),
		input: {
			category: candidate.category,
			reason: candidate.reason,
			requestId,
		},
		metadata: {
			category: candidate.category,
			feedback_id: candidate.feedbackId,
			feedback_updated_at: candidate.feedbackUpdatedAt,
			source: candidate.source,
			source_schema_version: "learning_loop_candidate.v2",
			...candidate.evidence,
		},
	};
}

function runtimeObservationSourceKey(candidate: LearningLoopCandidate, requestId: string): string {
	if (candidate.source !== "runtime_observation") {
		return requiredString(`${candidate.source}:${candidate.reason}`, "runtimeCandidateKey");
	}
	const stageField = requiredString(candidate.evidence.stageField ?? "", "stageField");
	const budgetVersion = requiredString(candidate.evidence.budgetVersion ?? "", "budgetVersion");
	return `runtime_observation:${requestId}:${stageField}:${budgetVersion}`;
}

export async function publishLearningLoopCandidateDatasetItems(input: {
	candidates: LearningLoopCandidate[];
	client: Pick<LangfuseEvalClient, "createDatasetItem">;
	dryRun: boolean;
}): Promise<{
	dryRun: boolean;
	publishedCount: number;
	selectedCount: number;
}> {
	const items = input.candidates.map((candidate) =>
		buildLearningLoopCandidateDatasetItem(candidate),
	);
	if (input.dryRun) {
		return {
			dryRun: true,
			publishedCount: 0,
			selectedCount: items.length,
		};
	}
	for (const item of items) {
		await input.client.createDatasetItem(item);
	}
	return {
		dryRun: false,
		publishedCount: items.length,
		selectedCount: items.length,
	};
}

export async function verifyLearningLoopCandidateDatasetItems(input: {
	candidates: LearningLoopCandidate[];
	client: Pick<LangfuseEvalClient, "getDataset">;
}): Promise<{
	expectedCount: number;
	matchedCount: number;
	missingIds: string[];
}> {
	const expectedIds = input.candidates.map((candidate) =>
		String(buildLearningLoopCandidateDatasetItem(candidate).id),
	);
	const dataset = await input.client.getDataset(LEARNING_LOOP_CANDIDATE_DATASET);
	const items = Array.isArray(dataset.items) ? dataset.items : [];
	const actualIds = new Set(
		items
			.map((item) =>
				typeof item === "object" && item !== null && "id" in item
					? String((item as { id?: unknown }).id ?? "")
					: "",
			)
			.filter(Boolean),
	);
	const missingIds = expectedIds.filter((id) => !actualIds.has(id));
	if (missingIds.length > 0) {
		throw new Error(`missing learning-loop candidate dataset items: ${missingIds.join(", ")}`);
	}
	return {
		expectedCount: expectedIds.length,
		matchedCount: expectedIds.length,
		missingIds,
	};
}

export function createLearningLoopCandidatePublisher(
	input: {
		client?: Pick<LangfuseEvalClient, "createDatasetItem" | "getDataset">;
		env?: NodeJS.ProcessEnv;
	} = {},
) {
	const client =
		input.client ??
		createLangfuseEvalClient({
			settings: settingsFromEnv(input.env ? { env: input.env } : {}),
		});
	return {
		async publish(candidates: LearningLoopCandidate[]) {
			const result = await publishLearningLoopCandidateDatasetItems({
				candidates,
				client,
				dryRun: false,
			});
			return {
				publishedCount: result.publishedCount,
			};
		},
		async verify(candidates: LearningLoopCandidate[]) {
			return verifyLearningLoopCandidateDatasetItems({
				candidates,
				client,
			});
		},
	};
}
