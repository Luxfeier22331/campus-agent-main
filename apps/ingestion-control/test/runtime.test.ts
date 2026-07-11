import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { InMemoryIngestionTaskStore } from "../src/in-memory-store.ts";
import { createIngestionTaskRegistryCatalog } from "../src/index.ts";
import {
	buildIngestionControlRuntimeConfig,
	type IngestionControlRuntime,
	startIngestionControlServer,
} from "../src/runtime.ts";

describe("ingestion-control runtime", () => {
	it("requires a Postgres URL for persistent control-plane state", () => {
		expect(() => buildIngestionControlRuntimeConfig({})).toThrow(
			"INGESTION_CONTROL_DATABASE_URL is required",
		);
	});

	it("requires Temporal for task admission instead of defaulting to an in-process executor", () => {
		expect(() =>
			buildIngestionControlRuntimeConfig({
				INGESTION_CONTROL_DATABASE_URL: "postgresql://postgres:postgres@localhost/campus_agent",
				INGESTION_TASK_REGISTRY_ROOT: "configs/ingestion",
			}),
		).toThrow("INGESTION_TEMPORAL_ADDRESS is required");
	});

	it("normalizes host and port without defaulting to an in-memory store", () => {
		expect(
			buildIngestionControlRuntimeConfig({
				INGESTION_CONTROL_DATABASE_URL: "postgresql://postgres:postgres@localhost/campus_agent",
				INGESTION_TASK_REGISTRY_ROOT: "configs/ingestion",
				INGESTION_CONTROL_ADMIN_TOKEN: " admin-token ",
				INGESTION_CONTROL_APP_API_PROJECTION_TOKEN: " app-api-projection-token ",
				INGESTION_CONTROL_OFFICIAL_WEB_COLLECTOR_TOKEN: " official-web-token ",
				INGESTION_CONTROL_OFFICIAL_WEB_EXECUTION_STATUS_TOKEN: " execution-status-token ",
				INGESTION_CONTROL_OFFICIAL_WEB_PROJECTION_TOKEN: " projection-token ",
				INGESTION_TEMPORAL_ADDRESS: "localhost:7233",
				INGESTION_CONTROL_HOST: "127.0.0.1",
				INGESTION_CONTROL_PORT: "27061",
			}),
		).toEqual({
			databaseUrl: "postgresql://postgres:postgres@localhost/campus_agent",
			registryRoot: "configs/ingestion",
			host: "127.0.0.1",
			port: 27061,
			serviceTokens: {
				adminToken: "admin-token",
				appApiProjectionToken: "app-api-projection-token",
				officialWebCollectorToken: "official-web-token",
				officialWebExecutionStatusToken: "execution-status-token",
				officialWebProjectionToken: "projection-token",
			},
			sourceBucket: "campus-agent-source",
			temporal: {
				address: "localhost:7233",
				namespace: "default",
				workflowTaskQueue: "campus-agent.ingestion.workflow",
				controlActivityTaskQueue: "campus-agent.ingestion.activity.control",
			},
		});
	});

	it("starts a single Temporal activity worker for declared ingestion tasks", () => {
		const workerSource = readFileSync(
			new URL("../src/temporal-worker.ts", import.meta.url),
			"utf-8",
		);

		expect(workerSource).toContain("taskQueue: temporalConfig.controlActivityTaskQueue");
		expect(workerSource).toContain("loadAuthenticatedNoticeFamilyConfigFromRegistryRoot");
		expect(workerSource).toContain("authenticatedNoticeFamilyConfig");
		expect(workerSource).not.toContain(["collector", "ActivityTaskQueue"].join(""));
		expect(workerSource).not.toContain(["provider", "ActivityTaskQueue"].join(""));
	});

	it("closes the shared runtime when HTTP listen fails", async () => {
		const blocker = createServer();
		await listenOnRandomLocalPort(blocker);
		const address = blocker.address();
		if (!address || typeof address === "string") {
			throw new Error("failed to bind local test port");
		}
		const runtime = new StubIngestionControlRuntime();

		try {
			await expect(
				startIngestionControlServer(
					{
						databaseUrl: "postgresql://postgres:postgres@localhost/campus_agent",
						host: "127.0.0.1",
						port: address.port,
						registryRoot: "configs/ingestion",
						serviceTokens: {
							adminToken: null,
							appApiProjectionToken: null,
							officialWebCollectorToken: null,
							officialWebExecutionStatusToken: null,
							officialWebProjectionToken: null,
						},
						sourceBucket: "campus-agent-source",
						temporal: {
							address: "localhost:7233",
							namespace: "default",
							workflowTaskQueue: "campus-agent.ingestion.workflow",
							controlActivityTaskQueue: "campus-agent.ingestion.activity.control",
						},
					},
					{ runtime },
				),
			).rejects.toThrow();
		} finally {
			await closeServer(blocker);
		}

		expect(runtime.closeCalls).toBe(1);
	});
});

function listenOnRandomLocalPort(server: ReturnType<typeof createServer>): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

class StubIngestionControlRuntime implements IngestionControlRuntime {
	closeCalls = 0;
	officialWebControlPlaneService = {
		async finalize(): Promise<never> {
			throw new Error("not implemented");
		},
		async heartbeat(): Promise<never> {
			throw new Error("not implemented");
		},
		async resolvePlan(): Promise<never> {
			throw new Error("not implemented");
		},
		async start(): Promise<never> {
			throw new Error("not implemented");
		},
	};
	officialWebExecutionStatusService = {
		async updateRunExecutionStatus(): Promise<never> {
			throw new Error("not implemented");
		},
	};
	officialWebProjectionProjector = {
		async drain(): Promise<never> {
			throw new Error("not implemented");
		},
	};
	registryCatalog = createIngestionTaskRegistryCatalog([]);
	store = new InMemoryIngestionTaskStore();
	workflowStarter = {
		async startTask(task: {
			task_id: string;
		}): Promise<{ workflowId: string; workflowRunId: string }> {
			return {
				workflowId: task.task_id,
				workflowRunId: "temporal-run-001",
			};
		},
	};

	async close(): Promise<void> {
		this.closeCalls += 1;
	}
}
