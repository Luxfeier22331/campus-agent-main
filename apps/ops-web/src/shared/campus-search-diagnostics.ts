import { z } from "zod";

export const CampusSearchCandidateSchema = z.object({
	resultRef: z.string(),
	sourceKind: z.enum(["document", "notice"]),
	title: z.string().max(400),
	section: z.string().max(400),
	fusionScore: z.number(),
	rerankScore: z.number().nullable(),
	retrievalRank: z.number().int(),
	rerankRank: z.number().int().nullable(),
	returned: z.boolean(),
	exclusionReason: z
		.enum(["rerank_below_threshold", "result_limit", "evidence_char_budget"])
		.optional(),
	text: z.string().max(4000),
	citationIndex: z.number().int().nullable(),
	cited: z.boolean().nullable(),
});

export const CampusSearchSnapshotSchema = z.object({
	effectiveQuery: z.string().max(1024),
	citationStart: z.number().int(),
	resultLimit: z.number().int(),
	retrievalMode: z.enum(["hybrid_rrf", "dense"]).optional(),
	durations: z.object({
		embedding: z.number().nonnegative().optional(),
		retrieval: z.number().nonnegative().optional(),
		rerank: z.number().nonnegative().optional(),
		selection: z.number().nonnegative().optional(),
	}),
	retrievedCount: z.number().int().nonnegative(),
	deduplicatedCount: z.number().int().nonnegative(),
	rerankInputCount: z.number().int().nonnegative(),
	rerankKeptCount: z.number().int().nonnegative(),
	returnedCount: z.number().int().nonnegative(),
	excludedCount: z.number().int().nonnegative(),
	candidates: z.array(CampusSearchCandidateSchema).max(24),
	snapshotTruncated: z.boolean(),
});

export const CampusSearchDiagnosticsSchema = z.object({
	dataState: z.enum(["FRESH", "PARTIAL", "NO_DATA", "UNAVAILABLE"]),
	reason: z.string().nullable(),
	calls: z.array(
		z.object({
			invocationId: z.string(),
			workflowStepId: z.string(),
			activityAttempt: z.number().int(),
			searchQuery: z.string().max(400),
			status: z.enum(["running", "completed", "failed", "canceled", "incomplete"]),
			currentPhase: z.string(),
			phaseTimes: z.record(z.string(), z.string()),
			queueMs: z.number().nonnegative().nullable(),
			toolTotalMs: z.number().nonnegative().nullable(),
			failureCode: z.string().nullable(),
			httpStatus: z.number().int().nullable(),
			snapshot: CampusSearchSnapshotSchema.nullable(),
			updatedAt: z.string(),
		}),
	),
});

export type CampusSearchDiagnostics = z.infer<typeof CampusSearchDiagnosticsSchema>;
