import assert from "node:assert/strict";
import test from "node:test";
import { activePods, databaseDrainCounts, waitUntilEmpty } from "../src/maintenance.ts";

test("drain waits for every durable and memory queue", async () => {
	const values = [
		{ runs: 1, memory: 0 },
		{ runs: 0, memory: 0 },
	];
	let index = 0;
	await waitUntilEmpty(async () => values[index++] ?? values.at(-1)!, 1000, 1);
	assert.equal(index, 2);
});

test("active pod selection ignores completed jobs and unrelated services", () => {
	assert.deepEqual(
		activePods([
			{
				metadata: { name: "agent", labels: { "app.kubernetes.io/name": "agent-runtime-worker" } },
				status: { phase: "Running" },
			},
			{
				metadata: { name: "done", labels: { "app.kubernetes.io/name": "memory-worker" } },
				status: { phase: "Succeeded" },
			},
			{
				metadata: { name: "other", labels: { "app.kubernetes.io/name": "qdrant" } },
				status: { phase: "Running" },
			},
		] as any).map((pod) => pod.metadata.name),
		["agent"],
	);
});

test("drain counts use terminal states as the release boundary", async () => {
	const queries: string[] = [];
	const product = {
		query: async (query: string) => {
			queries.push(query);
			return { rows: [{ count: 0 }] };
		},
	};
	const memory = {
		query: async (query: string) => {
			queries.push(query);
			return { rows: [{ count: 0 }] };
		},
	};
	const result = await databaseDrainCounts(product, memory);
	assert.equal(
		Object.values(result).every((value) => value === 0),
		true,
	);
	assert(queries.some((query) => query.includes("execution_control.agent_runs")));
	assert(queries.some((query) => query.includes("memory.requests")));
});

test("temporal drain includes the Memory workflow queue and does not count unrelated workflows", async () => {
	const { temporalWorkflowCount } = await import("../src/maintenance.ts");
	const queries: string[] = [];
	const temporal = {
		workflow: {
			async *list({ query }: { query: string }) {
				queries.push(query);
				if (query.includes("campus-agent.memory.workflow.v1")) {
					yield { workflowId: "memory-active" };
				}
			},
		},
	};
	assert.equal(await temporalWorkflowCount(temporal as any), 1);
	assert(queries.every((query) => query.includes('ExecutionStatus = "Running"')));
});

test("drain failure stops migration rather than treating pending work as empty", async () => {
	await assert.rejects(
		waitUntilEmpty(async () => ({ runs: 1 }), 0, 1),
		/timed out/,
	);
	await assert.rejects(
		databaseDrainCounts(
			{ query: async () => ({ rows: [] }) },
			{ query: async () => ({ rows: [] }) },
		),
		/Invalid drain counts/,
	);
});

test("drain includes a pending publisher Job before Kubernetes increments active", async () => {
	const { activeJobs } = await import("../src/maintenance.ts");
	const metadata = { name: "publish", labels: { "app.kubernetes.io/name": "notice-publisher" } };
	assert.equal(activeJobs([{ metadata }]).length, 1);
	assert.equal(
		activeJobs([{ metadata, status: { conditions: [{ type: "Complete", status: "True" }] } }])
			.length,
		0,
	);
});
