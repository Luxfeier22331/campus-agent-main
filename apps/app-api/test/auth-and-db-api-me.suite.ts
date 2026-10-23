import { describe, expect, it, vi } from "vitest";

import { APP_API_TEST_ENV, createApp } from "./auth-and-db-test-support";

function principal() {
	return {
		actor: {
			departments: [],
			principalId: "user_01HQ",
			principalType: "campus_member" as const,
			roles: ["campus_member"],
			userId: "user_01HQ",
		},
		permissions: { chat: true },
		principal: {
			displayName: "Jane Doe",
			email: "jane@example.edu",
			principalId: "user_01HQ",
			type: "campus_member" as const,
		},
		session: { expiresAt: "2026-07-20T00:00:00.000Z", sessionId: "session_01HQ" },
	};
}

export function registerApiMeSuite() {
	describe("GET /api/me", () => {
		it("returns the Better Auth session projection without shadow identity writes", async () => {
			const app = createApp(APP_API_TEST_ENV, {
				getPrincipal: vi.fn().mockResolvedValue(principal()),
			});
			const response = await app.fetch(new Request("https://app-api.internal/api/me"));
			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				permissions: { chat: true },
				principal: principal().principal,
				session: principal().session,
			});
		});
	});
}
