// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withRuntimeDatabase } from "../src/db/runtime";
import { appApiSchema } from "../src/db/schema";

const globalScope = globalThis as typeof globalThis & {
	WebSocketPair?: unknown;
};

const runtimeDbState = vi.hoisted(() => ({
	clients: [] as Array<{
		connect: ReturnType<typeof vi.fn>;
		end: ReturnType<typeof vi.fn>;
		options: unknown;
	}>,
	pools: [] as Array<{
		on: ReturnType<typeof vi.fn>;
		options: unknown;
	}>,
	drizzleCalls: [] as Array<{
		client: unknown;
		config: unknown;
	}>,
}));

vi.mock("pg", () => ({
	Client: class MockClient {
		connect = vi.fn(async () => undefined);
		end = vi.fn(async () => undefined);
		options: unknown;

		constructor(options: unknown) {
			this.options = options;
			runtimeDbState.clients.push(this);
		}
	},
	Pool: class MockPool {
		on = vi.fn();
		options: unknown;

		constructor(options: unknown) {
			this.options = options;
			runtimeDbState.pools.push(this);
		}
	},
}));

vi.mock("drizzle-orm/node-postgres", () => ({
	drizzle: vi.fn((client: unknown, config: unknown) => {
		runtimeDbState.drizzleCalls.push({
			client,
			config,
		});

		return {
			client,
			config,
			kind: "mock-runtime-db",
		};
	}),
}));

describe("withRuntimeDatabase", () => {
	const originalWebSocketPair = globalScope.WebSocketPair;

	beforeEach(() => {
		runtimeDbState.clients.length = 0;
		runtimeDbState.pools.length = 0;
		runtimeDbState.drizzleCalls.length = 0;
	});

	afterEach(() => {
		if (originalWebSocketPair) {
			globalScope.WebSocketPair = originalWebSocketPair;
		} else {
			delete globalScope.WebSocketPair;
		}
	});

	it("creates a fresh pg client per invocation inside the Worker runtime", async () => {
		globalScope.WebSocketPair = class MockWebSocketPair {};

		const env = {
			APP_API_DB: {
				connectionString: "postgres://postgres:secret@example.com:5432/campus_agent_worker",
			},
			DEPLOYMENT_ENVIRONMENT: "test" as const,
		};

		const firstDatabase = await withRuntimeDatabase(env, async (database) => database);
		const secondDatabase = await withRuntimeDatabase(env, async (database) => database);

		expect(runtimeDbState.clients).toHaveLength(2);
		expect(runtimeDbState.pools).toHaveLength(0);
		expect(runtimeDbState.drizzleCalls).toHaveLength(2);

		const [firstClient, secondClient] = runtimeDbState.clients;
		if (!(firstClient && secondClient)) {
			throw new Error("Expected two Worker runtime database clients.");
		}
		expect(firstClient).not.toBe(secondClient);
		expect(firstClient.connect).toHaveBeenCalledTimes(1);
		expect(firstClient.end).toHaveBeenCalledTimes(1);
		expect(secondClient.connect).toHaveBeenCalledTimes(1);
		expect(secondClient.end).toHaveBeenCalledTimes(1);
		expect(firstClient.options).toMatchObject({
			connectionString: "postgres://postgres:secret@example.com:5432/campus_agent_worker",
		});
		expect(secondClient.options).toMatchObject({
			connectionString: "postgres://postgres:secret@example.com:5432/campus_agent_worker",
		});

		expect(firstDatabase).toEqual({
			client: firstClient,
			config: {
				schema: appApiSchema,
			},
			kind: "mock-runtime-db",
		});
		expect(secondDatabase).toEqual({
			client: secondClient,
			config: {
				schema: appApiSchema,
			},
			kind: "mock-runtime-db",
		});
	});

	it("reuses one cached pg pool outside the Worker runtime", async () => {
		delete globalScope.WebSocketPair;

		const env = {
			APP_API_DB: {
				connectionString: "postgres://postgres:secret@example.com:5432/campus_agent_node",
			},
			DEPLOYMENT_ENVIRONMENT: "test" as const,
		};

		const firstDatabase = await withRuntimeDatabase(env, async (database) => database);
		const secondDatabase = await withRuntimeDatabase(env, async (database) => database);

		expect(runtimeDbState.clients).toHaveLength(0);
		expect(runtimeDbState.pools).toHaveLength(1);
		expect(runtimeDbState.drizzleCalls).toHaveLength(2);

		const [pool] = runtimeDbState.pools;
		if (!pool) {
			throw new Error("Expected one cached Node.js runtime database pool.");
		}
		expect(pool.options).toMatchObject({
			allowExitOnIdle: true,
			connectionString: "postgres://postgres:secret@example.com:5432/campus_agent_node",
			connectionTimeoutMillis: 5_000,
			idleTimeoutMillis: 5_000,
			max: 1,
		});
		expect(firstDatabase).toEqual({
			client: pool,
			config: {
				schema: appApiSchema,
			},
			kind: "mock-runtime-db",
		});
		expect(secondDatabase).toEqual({
			client: pool,
			config: {
				schema: appApiSchema,
			},
			kind: "mock-runtime-db",
		});
	});
});
