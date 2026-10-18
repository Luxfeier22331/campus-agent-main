import { readFileSync } from "node:fs";
import { request } from "node:https";
import { setTimeout as delay } from "node:timers/promises";
import { Connection, Client as TemporalClient } from "@temporalio/client";
import { Client } from "pg";
import { inspectCampusAgentSchema, readDatabaseConfig } from "./migrate.ts";

export const PROFILE = "agent-control-schema-rename";
export const CONSUMERS = [
	"agent-control",
	"agent-runtime-worker",
	"memory-service",
	"memory-worker",
	"memory-config-upgrade",
	"notice-pipeline-worker",
	"notice-artifacts-worker",
	"ops-web",
	"internal-portal-collection",
	"document-ocr",
	"notice-classifier",
	"notice-publisher",
	"notice-chunk-builder",
	"notice-embedding-builder",
];
export const TEMPORAL_QUEUES = [
	"campus-agent.agent.workflow.v1",
	"campus-agent.agent.model.v1",
	"campus-agent.agent.tool.v1",
	"campus-agent.memory.workflow.v1",
	"notice-pipeline",
	"notice-artifacts",
];
const SNAPSHOT = "agent-control-migration-state";
const SCHEDULE = "notice-pipeline";
interface Resource {
	metadata: { name: string; labels?: Record<string, string> };
	status?: {
		phase?: string;
		active?: number;
		conditions?: Array<{ type: string; status: string }>;
	};
	spec?: { replicas?: number; template?: { metadata?: { labels?: Record<string, string> } } };
	data?: Record<string, string>;
}
export interface Kube {
	get(path: string): Promise<Resource>;
	list(path: string): Promise<{ items: Resource[] }>;
	create(path: string, body: unknown): Promise<Resource>;
}
export function clusterClient(namespace: string): Kube {
	const prefix = `/api/v1/namespaces/${namespace}`;
	const call = <T>(path: string, method = "GET", body?: unknown) =>
		new Promise<T>((resolve, reject) => {
			const req = request(
				`https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? "443"}${path.startsWith("/") ? path : `${prefix}/${path}`}`,
				{
					method,
					ca: readFileSync("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"),
					headers: {
						Authorization: `Bearer ${readFileSync("/var/run/secrets/kubernetes.io/serviceaccount/token", "utf8").trim()}`,
						"Content-Type": "application/json",
					},
					timeout: 15_000,
				},
				(response) => {
					let text = "";
					response.setEncoding("utf8");
					response.on("data", (chunk: string) => {
						text += chunk;
					});
					response.on("end", () => {
						if ((response.statusCode ?? 500) >= 300) {
							reject(
								Object.assign(new Error(`Kubernetes ${method} ${path}: ${response.statusCode}`), {
									status: response.statusCode,
								}),
							);
						} else {
							try {
								resolve(JSON.parse(text) as T);
							} catch (error) {
								reject(error);
							}
						}
					});
				},
			);
			req.on("error", reject);
			req.on("timeout", () => req.destroy(new Error("Kubernetes timeout")));
			req.end(body === undefined ? undefined : JSON.stringify(body));
		});
	return {
		get: (path) => call(path),
		list: (path) => call(path),
		create: (path, body) => call(path, "POST", body),
	};
}
export async function waitUntilEmpty(
	read: () => Promise<Record<string, number>>,
	timeoutMs = 5 * 60 * 60 * 1000,
	pollMs = 10_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const counts = await read();
		console.log(JSON.stringify({ phase: "drain", counts }));
		if (Object.values(counts).every((value) => value === 0)) {
			return;
		}
		if (Date.now() >= deadline) {
			throw new Error("Maintenance drain timed out; old consumers must remain running");
		}
		await delay(pollMs);
	}
}
export interface Query {
	query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
}
export async function verifyAgentControlSchema(product: Query): Promise<void> {
	const result =
		await product.query(`SELECT to_regnamespace('execution_control') IS NULL AS old_absent,
        to_regnamespace('agent_control') IS NOT NULL AS new_present,
        (SELECT bool_and(has_table_privilege('agent_control','agent_control.agent_runs',privilege)) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS privilege) AS runs,
        (SELECT bool_and(has_table_privilege('agent_control','campus_docs_serving.current_index',privilege)) FROM unnest(ARRAY['SELECT','INSERT','UPDATE']) AS privilege) AS publisher`);
	if (
		!(
			Object.values(result.rows[0] ?? {}).every((value) => value === true) && result.rows.length > 0
		)
	) {
		throw new Error("Migration verification failed");
	}
}
export async function verifyAgentControlRuntime(product: Query, runtime: Query): Promise<void> {
	const runtimeConnect = await product.query(
		"SELECT has_database_privilege('agent_control', current_database(), 'CONNECT') AS allowed",
	);
	if (runtimeConnect.rows[0]?.allowed !== true) {
		throw new Error("Migration verification failed: agent_control lacks database CONNECT");
	}
	await runtime.query("SELECT request_id FROM agent_control.agent_runs LIMIT 0");
	await runtime.query("SELECT * FROM campus_docs_serving.current_index LIMIT 0");
}
export async function databaseDrainCounts(
	product: Query,
	memory: Query,
): Promise<Record<string, number>> {
	const tables: [name: string, table: string, predicate: string][] = [
		[
			"runs",
			"execution_control.agent_runs",
			"status NOT IN ('completed','failed','canceled','expired')",
		],
		["starts", "execution_control.agent_workflow_starts", "state IN ('pending','leased')"],
		["cancellations", "execution_control.agent_run_cancellations", "state IN ('pending','leased')"],
		["deliveries", "execution_control.agent_memory_deliveries", "status='ready'"],
		["dispatches", "chat.turn_dispatches", "status='accepted'"],
		["commands", "profile.memory_commands", "status IN ('pending_admission','admitted')"],
		["account_deletions", "profile.account_deletion_requests", "status='pending'"],
	];
	const counts: Record<string, number> = {};
	for (const [name, table, predicate] of tables) {
		counts[name] = Number(
			(await product.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${predicate}`))
				.rows[0]?.count,
		);
	}
	counts.memory = Number(
		(
			await memory.query(
				"SELECT count(*)::int AS count FROM memory.requests WHERE status NOT IN ('succeeded','completed','failed','skipped')",
			)
		).rows[0]?.count,
	);
	if (Object.values(counts).some((value) => !Number.isFinite(value))) {
		throw new Error("Invalid drain counts");
	}
	return counts;
}
export function activePods(items: Resource[]): Resource[] {
	return items.filter(
		(pod) =>
			CONSUMERS.includes(pod.metadata.labels?.["app.kubernetes.io/name"] ?? "") &&
			!["Succeeded", "Failed"].includes(pod.status?.phase ?? ""),
	);
}
export function activeJobs(items: Resource[]): Resource[] {
	return items.filter(
		(job) =>
			CONSUMERS.includes(
				job.spec?.template?.metadata?.labels?.["app.kubernetes.io/name"] ??
					job.metadata.labels?.["app.kubernetes.io/name"] ??
					"",
			) &&
			!job.status?.conditions?.some(
				(condition) =>
					["Complete", "Failed"].includes(condition.type) && condition.status === "True",
			),
	);
}
export async function temporalWorkflowCount(temporal: {
	workflow: {
		list(options: { query: string }): AsyncIterable<{ workflowId: string }>;
	};
}): Promise<number> {
	const ids = new Set<string>();
	for (const queue of TEMPORAL_QUEUES) {
		for await (const run of temporal.workflow.list({
			query: `TaskQueue = "${queue}" AND ExecutionStatus = "Running"`,
		})) {
			ids.add(run.workflowId);
		}
	}
	return ids.size;
}
const required = (key: string) => {
	const value = process.env[key];
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
};
export async function maintenance(command: string): Promise<void> {
	if (!["prepare", "drain", "quiescent", "verify", "restore"].includes(command)) {
		throw new Error("maintenance requires prepare|drain|quiescent|verify|restore");
	}
	const namespace = required("MAINTENANCE_NAMESPACE");
	const promotion = required("MAINTENANCE_PROMOTION");
	const kube = clusterClient(namespace);
	const connection = await Connection.connect({ address: required("TEMPORAL_ADDRESS") });
	const temporal = new TemporalClient({ connection, namespace: required("TEMPORAL_NAMESPACE") });
	const schedule = temporal.schedule.getHandle(SCHEDULE);
	const product = new Client(readDatabaseConfig());
	const memory = new Client(
		readDatabaseConfig({
			...process.env,
			PGDATABASE: "memory",
			PGUSER: required("MEMORY_PGUSER"),
			PGPASSWORD: required("MEMORY_PGPASSWORD"),
		}),
	);
	try {
		await product.connect();
		await memory.connect();
		if (command === "prepare") {
			const schemas = (
				await product.query(
					"SELECT nspname FROM pg_namespace WHERE nspname IN ('execution_control','agent_control')",
				)
			).rows;
			if (schemas.length !== 1 || schemas[0]?.nspname !== "execution_control") {
				throw new Error("Migration requires the old schema only");
			}
			let snapshot: Resource;
			try {
				snapshot = await kube.get(`configmaps/${SNAPSHOT}`);
			} catch (error) {
				if ((error as { status?: number }).status !== 404) {
					throw error;
				}
				const state = await schedule.describe();
				snapshot = await kube.create("configmaps", {
					apiVersion: "v1",
					kind: "ConfigMap",
					metadata: { name: SNAPSHOT, namespace },
					data: { promotion, schedulePaused: String(state.state.paused) },
				});
			}
			if (snapshot.data?.promotion !== promotion) {
				throw new Error("Another maintenance owns the schedule snapshot");
			}
			await schedule.pause("Agent Control schema migration");
		} else if (command === "restore") {
			const snapshot = await kube.get(`configmaps/${SNAPSHOT}`);
			if (snapshot.data?.promotion !== promotion) {
				throw new Error("Maintenance snapshot owner mismatch");
			}
			if (snapshot.data.schedulePaused === "false") {
				await schedule.unpause("Agent Control schema migration completed");
			}
		} else if (command === "drain" || command === "quiescent") {
			await waitUntilEmpty(
				async () => {
					const counts = await databaseDrainCounts(product, memory);
					// Dedicated staging namespace: visibility is combined with durable DB work,
					// never used as the sole proof that claimed activities have completed.
					counts.workflows = await temporalWorkflowCount(temporal);
					const jobs = await kube.list(`/apis/batch/v1/namespaces/${namespace}/jobs`);
					counts.jobs = activeJobs(jobs.items).length;
					if (command === "quiescent") {
						counts.pods = activePods((await kube.list("pods")).items).length;
						counts.connections = Number(
							(
								await product.query(
									"SELECT count(*)::int AS count FROM pg_stat_activity WHERE usename='execution_control' AND pid<>pg_backend_pid()",
								)
							).rows[0]?.count,
						);
					}
					return counts;
				},
				command === "quiescent" ? 600_000 : undefined,
			);
		} else {
			const status = await inspectCampusAgentSchema();
			if (status.status !== "current") {
				throw new Error("Schema migration is not current");
			}
			await verifyAgentControlSchema(product);
			const runtime = new Client({
				connectionString: required("AGENT_CONTROL_DATABASE_URL"),
				ssl: readDatabaseConfig().ssl,
			});
			await runtime.connect();
			try {
				await verifyAgentControlRuntime(product, runtime);
			} finally {
				await runtime.end();
			}
		}
		console.log(JSON.stringify({ profile: PROFILE, command, result: "complete" }));
	} finally {
		await Promise.allSettled([product.end(), memory.end()]);
		await connection.close();
	}
}
