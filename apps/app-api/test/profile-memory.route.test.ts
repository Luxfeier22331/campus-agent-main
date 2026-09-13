// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { ProfileMemoryService } from "../src/modules/profile-memory";

const env = {
	DEPLOYMENT_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
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
	const pending = {
		commandId: "memcmd_01",
		lifecycleState: "active" as const,
		syncStatus: "synced" as const,
	};
	return {
		applyResult: vi.fn(async () => "applied" as const),
		createItem: vi.fn(async () => pending),
		updateItem: vi.fn(async () => pending),
		retryCommand: vi.fn(async () => pending),
		dispatchPending: vi.fn(async () => ({ admitted: 0, failed: 0, processed: 0 })),
		erase: vi.fn(async () => ({
			...pending,
			lifecycleState: "erasing" as const,
			syncStatus: "pending" as const,
		})),
		eraseForAccountDeletion: vi.fn(async () => ({
			...pending,
			lifecycleState: "erasing" as const,
			syncStatus: "pending" as const,
		})),
		list: vi.fn(async () => ({
			operations: [],
			lifecycleState: "active" as const,
			syncStatus: "synced" as const,
		})),
		listItems: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
		getItem: vi.fn(async () => ({
			memoryId: "fact",
			text: "先给结论",
			kind: "fact" as const,
			state: "active" as const,
			origin: "manual" as const,
			mentionedAt: null,
			editedAt: null,
		})),
		setLifecycle: vi.fn(async () => ({
			...pending,
			lifecycleState: "paused" as const,
			syncStatus: "pending" as const,
		})),
	};
}

describe("profile memory routes", () => {
	it("returns local lifecycle and operation status independently of provider content", async () => {
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(principal()),
			profileMemoryService: service(),
		});
		const response = await app.fetch(new Request("https://app-api.internal/api/me/profile-memory"));
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			profileMemory: { operations: [], lifecycleState: "active", syncStatus: "synced" },
		});
	});

	it.each([
		["POST", "/api/me/profile-memory/items", { text: "先给结论" }],
		["PATCH", "/api/me/profile-memory/items/mem_01", { text: "简洁回答" }],
		["PATCH", "/api/me/profile-memory/settings", { enabled: false }],
		["PATCH", "/api/me/profile-memory/items/mem_01", { state: "inactive" }],
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
		expect(profileMemoryService.dispatchPending).toHaveBeenCalledTimes(1);
	});

	it("retires per-item deletion", async () => {
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(principal()),
			profileMemoryService: service(),
		});
		expect(
			(
				await app.fetch(
					new Request("https://app-api.internal/api/me/profile-memory/items/fact", {
						method: "DELETE",
					}),
				)
			).status,
		).toBe(404);
	});
	it("passes the search, type, state and pagination to the reader", async () => {
		const memory = service();
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(principal()),
			profileMemoryService: memory,
		});
		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/me/profile-memory/items?q=偏好&kind=fact&state=inactive&limit=10&offset=20",
			),
		);
		expect(response.status).toBe(200);
		expect(memory.listItems).toHaveBeenCalledWith(
			expect.objectContaining({
				q: "偏好",
				kind: "fact",
				state: "inactive",
				limit: 10,
				offset: 20,
			}),
		);
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
