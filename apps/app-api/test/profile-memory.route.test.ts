// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { ProfileMemoryService } from "../src/modules/profile-memory";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
	APP_API_DB: { connectionString: "postgres://postgres:secret@example.com:5432/campus_agent" },
};

function principal() {
	return {
		actor: {
			departments: [],
			principalId: "user_01HQ",
			principalType: "campus_member" as const,
			roles: ["campus_member"],
			userId: "user_01HQ",
		},
		authorization: undefined,
		permissions: { chat: true },
		principal: {
			displayName: "Jane Doe",
			email: "jane@example.edu",
			principalId: "user_01HQ",
			type: "campus_member" as const,
		},
		session: { expiresAt: "2026-03-29T07:00:00.000Z", sessionId: "sess_01HQ" },
	};
}

function service(): ProfileMemoryService {
	const pending = { lifecycleState: "active" as const, syncStatus: "pending" as const };
	return {
		applyResult: vi.fn(async () => "applied" as const),
		createItem: vi.fn(async () => ({
			...pending,
			item: {
				itemId: "mem_01",
				key: "answer_style",
				revision: 1,
				state: "saving" as const,
				updatedAt: "2026-04-27T00:00:00.000Z",
				value: "先给结论",
			},
		})),
		deleteItem: vi.fn(async () => pending),
		dispatchPending: vi.fn(async () => ({ admitted: 0, failed: 0, processed: 0 })),
		erase: vi.fn(async () => ({
			lifecycleState: "erasing" as const,
			syncStatus: "pending" as const,
		})),
		list: vi.fn(async () => ({
			itemCount: 0,
			items: [],
			lifecycleState: "active" as const,
			syncStatus: "synced" as const,
		})),
		setLifecycle: vi.fn(async () => ({
			lifecycleState: "paused" as const,
			syncStatus: "pending" as const,
		})),
		updateItem: vi.fn(async () => ({
			...pending,
			item: {
				itemId: "mem_01",
				key: "answer_style",
				revision: 2,
				state: "saving" as const,
				updatedAt: "2026-04-27T00:00:00.000Z",
				value: "简洁回答",
			},
		})),
	};
}

describe("profile memory routes", () => {
	it("returns the canonical local projection", async () => {
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(principal()),
			profileMemoryService: service(),
		});
		const response = await app.fetch(new Request("https://app-api.internal/api/me/profile-memory"));
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			profileMemory: { itemCount: 0, items: [], lifecycleState: "active", syncStatus: "synced" },
		});
	});

	it.each([
		["POST", "/api/me/profile-memory/items", { key: "answer_style", value: "先给结论" }],
		["PATCH", "/api/me/profile-memory/items/mem_01", { key: "answer_style", value: "简洁回答" }],
		["PATCH", "/api/me/profile-memory/settings", { enabled: false }],
		["DELETE", "/api/me/profile-memory/items/mem_01", undefined],
		["DELETE", "/api/me/profile-memory", undefined],
	] as const)("requires idempotency and returns 202 for %s %s", async (method, path, body) => {
		const profileMemoryService = service();
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(principal()),
			profileMemoryService,
		});
		const response = await app.fetch(
			new Request(`https://app-api.internal${path}`, {
				...(body ? { body: JSON.stringify(body) } : {}),
				headers: {
					"content-type": "application/json",
					"idempotency-key": `idem-${method.toLowerCase()}-0001`,
				},
				method,
			}),
		);
		expect(response.status).toBe(202);
	});

	it("rejects mutations without Idempotency-Key", async () => {
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(principal()),
			profileMemoryService: service(),
		});
		const response = await app.fetch(
			new Request("https://app-api.internal/api/me/profile-memory", { method: "DELETE" }),
		);
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "idempotency_key_required" },
		});
	});
});
