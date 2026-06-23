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

import {
	temporalTaskQueueCurrent,
	temporalTaskQueueSnapshot,
	workerAutoscalerDecision,
	workerAutoscalerDecisionCurrent,
} from "../src/db/schema";
import { createPgOperatorObservabilityCommandStore } from "../src/modules/operator-observability-command";
import { createPgOperatorQueryStore } from "../src/modules/operator-query/store";

const snapshot = {
	backlog: { count: 12, state: "observed" as const },
	namespace: "default",
	oldestTaskAge: { ms: 4500, state: "observed" as const },
	pollerCount: 1,
	pollerIdentities: ["knowledge-worker-1"],
	projectedAt: "2026-06-15T10:00:02.000Z",
	sampledAt: "2026-06-15T10:00:00.000Z",
	scheduleToStartLatency: { ms: null, state: "unsupported_by_source" as const },
	snapshotId: "temporal-snapshot-20260615T100000Z",
	source: "execution-control.temporal-task-queue-sampler",
	taskQueue: "campus-agent.activity.knowledge.retrieval",
	taskQueueKind: "activity" as const,
};

const decision = {
	budgetState: "within_budget" as const,
	currentReplicas: 1,
	decidedAt: "2026-06-15T10:00:05.000Z",
	decision: "hold" as const,
	decisionId: "decision-20260615T100005Z",
	desiredReplicas: 1,
	evidence: {
		backlog: { count: 12, state: "observed" },
		oldestTaskAge: { ms: 4500, state: "observed" },
		pollerCount: 1,
	},
	projectedAt: "2026-06-15T10:00:02.000Z",
	reason: "replica target already satisfied",
	sourceSnapshotId: "temporal-snapshot-20260615T100000Z",
	targetService: "activity-worker-knowledge-retrieval",
	taskQueue: "campus-agent.activity.knowledge.retrieval",
	taskQueueKind: "activity" as const,
};

function buildDbMock() {
	const insertedTables: unknown[] = [];
	const valuesPayloads: unknown[] = [];
	const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
	const values = vi.fn((payload: unknown) => {
		valuesPayloads.push(payload);
		return { onConflictDoUpdate };
	});
	const insert = vi.fn((table: unknown) => {
		insertedTables.push(table);
		return { values };
	});
	const db = {
		transaction: vi.fn(async (callback: (tx: { insert: typeof insert }) => Promise<void>) =>
			callback({ insert }),
		),
	};
	return { db, insertedTables, onConflictDoUpdate, valuesPayloads };
}

describe("operator runtime projection store", () => {
	beforeEach(() => {
		createRuntimeDatabase.mockReset();
		createRuntimeDbGetter.mockClear();
		createRuntimeDbGetter.mockImplementation(() => () => createRuntimeDatabase());
	});

	it("updates bounded current runtime projections without appending history by default", async () => {
		const dbMock = buildDbMock();
		createRuntimeDatabase.mockResolvedValue(dbMock.db);
		const store = createPgOperatorObservabilityCommandStore({} as never, {
			getDb: () => createRuntimeDatabase() as never,
		});

		await store.upsertTemporalTaskQueueRuntime({
			actuations: [],
			decisions: [decision],
			snapshots: [snapshot],
		});

		expect(dbMock.insertedTables).toContain(temporalTaskQueueCurrent);
		expect(dbMock.insertedTables).toContain(workerAutoscalerDecisionCurrent);
		expect(dbMock.insertedTables).not.toContain(temporalTaskQueueSnapshot);
		expect(dbMock.insertedTables).not.toContain(workerAutoscalerDecision);
		expect(dbMock.valuesPayloads).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					currentId: "default:activity:campus-agent.activity.knowledge.retrieval",
					snapshotId: "temporal-snapshot-20260615T100000Z",
				}),
				expect.objectContaining({
					currentId: "activity-worker-knowledge-retrieval",
					decisionId: "decision-20260615T100005Z",
				}),
			]),
		);
	});

	it("persists runtime history only for explicit proof ingestion", async () => {
		const dbMock = buildDbMock();
		createRuntimeDatabase.mockResolvedValue(dbMock.db);
		const store = createPgOperatorObservabilityCommandStore({} as never, {
			getDb: () => createRuntimeDatabase() as never,
		});

		await store.upsertTemporalTaskQueueRuntime({
			actuations: [],
			decisions: [decision],
			persistHistory: true,
			snapshots: [snapshot],
		});

		expect(dbMock.insertedTables).toContain(temporalTaskQueueCurrent);
		expect(dbMock.insertedTables).toContain(workerAutoscalerDecisionCurrent);
		expect(dbMock.insertedTables).toContain(temporalTaskQueueSnapshot);
		expect(dbMock.insertedTables).toContain(workerAutoscalerDecision);
	});

	it("lists Temporal task queues from the bounded current projection", async () => {
		const row = {
			backlogJson: snapshot.backlog,
			currentId: "default:activity:campus-agent.activity.knowledge.retrieval",
			namespace: snapshot.namespace,
			oldestTaskAgeJson: snapshot.oldestTaskAge,
			pollerCount: snapshot.pollerCount,
			pollerIdentitiesJson: snapshot.pollerIdentities,
			projectedAt: new Date(snapshot.projectedAt),
			sampledAt: new Date(snapshot.sampledAt),
			scheduleToStartLatencyJson: snapshot.scheduleToStartLatency,
			snapshotId: snapshot.snapshotId,
			source: snapshot.source,
			taskQueue: snapshot.taskQueue,
			taskQueueKind: snapshot.taskQueueKind,
		};
		const fromTables: unknown[] = [];
		const limit = vi.fn().mockResolvedValue([row]);
		const orderBy = vi.fn(() => ({ limit }));
		const from = vi.fn((table: unknown) => {
			fromTables.push(table);
			return { orderBy };
		});
		createRuntimeDatabase.mockResolvedValue({ select: vi.fn(() => ({ from })) });
		const store = createPgOperatorQueryStore({} as never, {
			getDb: () => createRuntimeDatabase() as never,
		});

		const result = await store.listTemporalTaskQueues({
			cursor: null,
			limit: 10,
			taskQueue: null,
			taskQueueKind: null,
		});

		expect(fromTables).toContain(temporalTaskQueueCurrent);
		expect(fromTables).not.toContain(temporalTaskQueueSnapshot);
		expect(result.snapshots).toEqual([snapshot]);
		expect(result.page.nextCursor).toBeNull();
	});

	it("lists autoscaler decisions from the bounded current projection", async () => {
		const row = {
			...decision,
			currentId: "activity-worker-knowledge-retrieval",
			decidedAt: new Date(decision.decidedAt),
			evidenceJson: decision.evidence,
			projectedAt: new Date(decision.projectedAt),
		};
		const fromTables: unknown[] = [];
		const limit = vi.fn().mockResolvedValue([row]);
		const orderBy = vi.fn(() => ({ limit }));
		const from = vi.fn((table: unknown) => {
			fromTables.push(table);
			return { orderBy };
		});
		createRuntimeDatabase.mockResolvedValue({ select: vi.fn(() => ({ from })) });
		const store = createPgOperatorQueryStore({} as never, {
			getDb: () => createRuntimeDatabase() as never,
		});

		const result = await store.listAutoscalerDecisions({
			cursor: null,
			decision: null,
			limit: 10,
			targetService: null,
		});

		expect(fromTables).toContain(workerAutoscalerDecisionCurrent);
		expect(fromTables).not.toContain(workerAutoscalerDecision);
		expect(result.decisions).toEqual([
			{
				budgetState: decision.budgetState,
				currentReplicas: decision.currentReplicas,
				decidedAt: decision.decidedAt,
				decision: decision.decision,
				decisionId: decision.decisionId,
				desiredReplicas: decision.desiredReplicas,
				projectedAt: decision.projectedAt,
				reason: decision.reason,
				sourceSnapshotId: decision.sourceSnapshotId,
				targetService: decision.targetService,
				taskQueue: decision.taskQueue,
				taskQueueKind: decision.taskQueueKind,
			},
		]);
		expect(result.page.nextCursor).toBeNull();
	});
});
