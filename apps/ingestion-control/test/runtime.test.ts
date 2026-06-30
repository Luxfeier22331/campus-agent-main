import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { createIngestionTaskRegistryCatalog, InMemoryIngestionTaskStore } from "../src/index.ts";
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

	it("normalizes host and port without defaulting to an in-memory store", () => {
		expect(
			buildIngestionControlRuntimeConfig({
				INGESTION_CONTROL_DATABASE_URL: "postgresql://postgres:postgres@localhost/campus_agent",
				INGESTION_TASK_REGISTRY_ROOT: "configs/ingestion",
				INGESTION_CONTROL_HOST: "127.0.0.1",
				INGESTION_CONTROL_PORT: "27061",
			}),
		).toEqual({
			databaseUrl: "postgresql://postgres:postgres@localhost/campus_agent",
			registryRoot: "configs/ingestion",
			host: "127.0.0.1",
			port: 27061,
		});
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
	registryCatalog = createIngestionTaskRegistryCatalog([]);
	store = new InMemoryIngestionTaskStore();

	async close(): Promise<void> {
		this.closeCalls += 1;
	}
}
