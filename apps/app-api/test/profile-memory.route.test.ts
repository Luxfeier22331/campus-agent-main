// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { ProfileMemoryService } from "../src/modules/profile-memory";

const env = {
	DEPLOYMENT_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	CLUSTER_PRIVATE_BASE_URL: "https://agent-control.internal",
	EDGE_INGRESS_SHARED_SECRET: "shared-secret",
	APP_API_INTERNAL_SHARED_SECRET: "shared-secret",
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
		submitCorrection: vi.fn(async () => pending),
		retryCommand: vi.fn(async () => pending),
		dispatchPending: vi.fn(async () => ({ admitted: 0, failed: 0, processed: 0 })),
		erase: vi.fn(async () => ({
			...pending,
			lifecycleState: "erased" as const,
			syncStatus: "pending" as const,
		})),
		eraseForAccountDeletion: vi.fn(async () => ({
			...pending,
			lifecycleState: "erased" as const,
			syncStatus: "pending" as const,
		})),
		list: vi.fn(async () => ({
			operations: [],
			lifecycleState: "active" as const,
			syncStatus: "synced" as const,
		})),
		getProfile: vi.fn(async () => ({
			content: "偏好简洁回复",
			generating: false,
			isStale: false,
			lastRefreshedAt: "2026-09-24T00:00:00Z",
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
		["POST", "/api/me/profile-memory/corrections", { text: "先给结论" }],
		["PATCH", "/api/me/profile-memory/settings", { enabled: false }],
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

	it("retires per-item CRUD routes", async () => {
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(principal()),
			profileMemoryService: service(),
		});
		for (const path of [
			"/api/me/profile-memory/items",
			"/api/me/profile-memory/items/fact",
		] as const) {
			for (const method of ["GET", "POST", "PATCH", "DELETE"] as const) {
				const response = await app.fetch(
					new Request(`https://app-api.internal${path}`, {
						...(method === "GET" || method === "DELETE"
							? {}
							: {
									body: JSON.stringify({ text: "先给结论" }),
									headers: {
										"content-type": "application/json",
										"idempotency-key": "idem-retired-0001",
									},
								}),
						method,
					}),
				);
				expect(response.status, `${method} ${path}`).toBe(404);
			}
		}
	});
	it("returns the synthesized profile", async () => {
		const memory = service();
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(principal()),
			profileMemoryService: memory,
		});
		const response = await app.fetch(
			new Request("https://app-api.internal/api/me/profile-memory/profile"),
		);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			profile: {
				content: "偏好简洁回复",
				generating: false,
				isStale: false,
				lastRefreshedAt: "2026-09-24T00:00:00Z",
			},
		});
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
