// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import {
	createCampusPrincipal,
	createOperatorPrincipal,
	env,
} from "./operator-query.route.test-support";

const internalEnv = {
	...env,
	APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
};

const evalCoverageSnapshot = {
	schemaVersion: "eval_coverage_snapshot.v1",
	snapshotId: "eval_coverage:2026-05-21T090000Z",
	generatedAt: "2026-05-21T09:00:00.000Z",
	sourceGitHead: "git-main",
	sourceReportSchema: "rag-eval-coverage-report.v1",
	denominatorSurfaces: [
		"regulations/student_rules",
		"regulations/institutional_rules",
		"curriculum/curriculum_plan",
		"official_web/stable_reference",
	],
	surfaces: [
		{
			answerQualityCaseCount: 18,
			coverageGaps: [],
			goldenQrelsCaseCount: 52,
			knownGapCaseCount: 4,
			lastGate: {
				artifactId: "student-rules-release-gate",
				artifactKind: "formal_final_summary",
				caseCount: 25,
				failedCount: 0,
				gitHead: "git-main",
				passedCount: 25,
				profileId: "handbook",
				reasons: [],
				status: "passed",
				surfaceKey: "regulations/student_rules",
			},
			maturityGaps: [],
			maturityStatus: "ready",
			profileArtifactKind: "release_acceptance",
			profileId: "handbook",
			qrelsCaseCount: 52,
			ragasDiagnostic: {
				caseCount: 2,
				completedCaseCount: 2,
				failedCaseCount: 0,
				lowScoreCases: [
					{
						caseId: "student-case",
						metricName: "answer_relevancy",
						score: 0.7,
					},
				],
				metrics: [
					{
						count: 2,
						max: 1,
						mean: 0.85,
						min: 0.7,
						name: "answer_relevancy",
					},
				],
				status: "diagnostic_attention",
			},
			readiness: {
				reasons: [],
				status: "diagnostic_attention",
			},
			releaseAcceptanceCaseCount: 25,
			surfaceKey: "regulations/student_rules",
			uniqueExpectedDocCount: 28,
		},
	],
	excludedSurfaces: [
		{
			reason: "excluded from current RAG consumption denominator",
			surfaceKey: "official_web/fresh_news",
		},
	],
};

describe("operator eval coverage routes", () => {
	it("accepts an operator-safe eval coverage snapshot through the internal publish seam", async () => {
		const commandService = {
			ingestEvalCoverageSnapshot: vi.fn().mockResolvedValue({
				accepted: 1,
				snapshotId: evalCoverageSnapshot.snapshotId,
			}),
		};
		const app = createApp(internalEnv as never, {
			operatorObservabilityCommandService: commandService as never,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/operator/evals/coverage-snapshots", {
				body: JSON.stringify(evalCoverageSnapshot),
				headers: {
					"content-type": "application/json",
					"x-app-internal-auth": "trusted-secret",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			accepted: 1,
			snapshotId: evalCoverageSnapshot.snapshotId,
		});
		expect(commandService.ingestEvalCoverageSnapshot).toHaveBeenCalledWith({
			payload: evalCoverageSnapshot,
		});
	});

	it("fails closed when eval coverage snapshot publish lacks the internal credential", async () => {
		const commandService = {
			ingestEvalCoverageSnapshot: vi.fn(),
		};
		const app = createApp(internalEnv as never, {
			operatorObservabilityCommandService: commandService as never,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/operator/evals/coverage-snapshots", {
				body: JSON.stringify(evalCoverageSnapshot),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "service_credential_required",
			},
		});
		expect(commandService.ingestEvalCoverageSnapshot).not.toHaveBeenCalled();
	});

	it("returns the latest eval coverage projection for operator principals", async () => {
		const principal = createOperatorPrincipal();
		const queryService = {
			getEvalCoverage: vi.fn().mockResolvedValue(evalCoverageSnapshot),
		};
		const app = createApp(env as never, {
			getPrincipal: vi.fn().mockResolvedValue(principal),
			operatorQueryService: queryService as never,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/operator/evals/coverage"),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual(evalCoverageSnapshot);
		expect(queryService.getEvalCoverage).toHaveBeenCalledWith({ principal });
	});

	it("keeps eval coverage unavailable to non-operator principals", async () => {
		const queryService = {
			getEvalCoverage: vi.fn(),
		};
		const app = createApp(env as never, {
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
			operatorQueryService: queryService as never,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/operator/evals/coverage"),
		);

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "forbidden",
			},
		});
		expect(queryService.getEvalCoverage).not.toHaveBeenCalled();
	});
});
