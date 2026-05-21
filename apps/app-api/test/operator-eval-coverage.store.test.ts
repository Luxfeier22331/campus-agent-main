// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRuntimeDatabase, createRuntimeDbGetter } = vi.hoisted(() => ({
	createRuntimeDatabase: vi.fn(),
	createRuntimeDbGetter: vi.fn(() => () => createRuntimeDatabase()),
}));

vi.mock("../src/db/runtime", () => ({
	createRuntimeDatabase,
	createRuntimeDbGetter,
}));

import { createPgOperatorObservabilityCommandStore } from "../src/modules/operator-observability-command";
import { createPgOperatorQueryStore } from "../src/modules/operator-query/store";

const snapshot = {
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
	surfaces: [],
	excludedSurfaces: [],
};

describe("operator eval coverage store", () => {
	beforeEach(() => {
		createRuntimeDatabase.mockReset();
		createRuntimeDbGetter.mockClear();
		createRuntimeDbGetter.mockImplementation(() => () => createRuntimeDatabase());
	});

	it("upserts eval coverage snapshots by snapshot id", async () => {
		const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
		const values = vi.fn(() => ({ onConflictDoUpdate }));
		const insert = vi.fn(() => ({ values }));
		createRuntimeDatabase.mockResolvedValue({ insert });
		const store = createPgOperatorObservabilityCommandStore({} as never, {
			getDb: () => createRuntimeDatabase() as never,
		});

		await store.upsertEvalCoverageSnapshot({
			snapshot: {
				generatedAt: snapshot.generatedAt,
				payload: snapshot as never,
				schemaVersion: "eval_coverage_snapshot.v1",
				snapshotId: snapshot.snapshotId,
				sourceGitHead: snapshot.sourceGitHead,
			},
		});

		expect(values).toHaveBeenCalledWith(
			expect.objectContaining({
				generatedAt: new Date("2026-05-21T09:00:00.000Z"),
				payloadJson: snapshot,
				schemaVersion: "eval_coverage_snapshot.v1",
				snapshotId: snapshot.snapshotId,
				sourceGitHead: "git-main",
			}),
		);
		expect(onConflictDoUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				target: expect.anything(),
			}),
		);
	});

	it("reads the latest eval coverage snapshot projection", async () => {
		const latestSnapshot = {
			...snapshot,
			generatedAt: "2026-05-21T10:00:00.000Z",
			snapshotId: "eval_coverage:2026-05-21T100000Z",
			surfaces: [
				...[
					"regulations/student_rules",
					"regulations/institutional_rules",
					"curriculum/curriculum_plan",
					"official_web/stable_reference",
				].map((surfaceKey) => ({
					answerQualityCaseCount: 1,
					coverageGaps: [],
					goldenQrelsCaseCount: 1,
					knownGapCaseCount: 0,
					lastGate: {
						artifactId: `${surfaceKey}:gate`,
						artifactKind: "formal_final_summary",
						caseCount: 1,
						failedCount: 0,
						gitHead: "git-main",
						passedCount: 1,
						profileId: surfaceKey,
						reasons: [],
						status: "passed",
						surfaceKey,
					},
					maturityGaps: [],
					maturityStatus: "ready",
					profileArtifactKind: "release_acceptance",
					profileId: surfaceKey,
					qrelsCaseCount: 1,
					ragasDiagnostic: {
						caseCount: 0,
						completedCaseCount: 0,
						failedCaseCount: 0,
						lowScoreCases: [],
						metrics: [],
						stageDistribution: [],
						status: "artifact_missing",
					},
					readiness: {
						reasons: [],
						status: "ready",
					},
					releaseAcceptanceCaseCount: 1,
					surfaceKey,
					uniqueExpectedDocCount: 1,
				})),
			],
		};
		const limit = vi.fn().mockResolvedValue([{ payloadJson: latestSnapshot }]);
		const orderBy = vi.fn(() => ({ limit }));
		const from = vi.fn(() => ({ orderBy }));
		const select = vi.fn(() => ({ from }));
		createRuntimeDatabase.mockResolvedValue({ select });
		const store = createPgOperatorQueryStore({} as never, {
			getDb: () => createRuntimeDatabase() as never,
		});

		const result = await store.getEvalCoverage();

		expect(result?.snapshotId).toBe("eval_coverage:2026-05-21T100000Z");
		expect(orderBy).toHaveBeenCalled();
		expect(limit).toHaveBeenCalledWith(1);
	});
});
