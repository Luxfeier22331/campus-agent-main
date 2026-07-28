// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createAccountAdminClient } from "../src/server/account-admin-client";

const page = {
	items: [
		{
			accessSource: "campus_email",
			accessState: "allowed",
			activeSessionCount: 0,
			createdAt: "2026-07-19T00:00:00.000Z",
			email: "student@muc.edu.cn",
			emailVerified: true,
			id: "user_1",
			name: "Student",
			state: "active",
			updatedAt: "2026-07-19T00:00:00.000Z",
		},
	],
	nextCursor: null,
};

describe("account administration App API client", () => {
	it("uses the internal token and parses user pages", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(page), {
				headers: { "content-type": "application/json" },
				status: 200,
			}),
		);
		const client = createAccountAdminClient(
			{ OPS_WEB_APP_API_URL: "https://app-api.internal", OPS_WEB_INTERNAL_TOKEN: "ops-token" },
			{ fetchImplementation },
		);
		const search = new URLSearchParams({ limit: "20", state: "active" });
		await expect(client.listUsers(search)).resolves.toEqual(page);
		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://app-api.internal/api/internal/admin/users?limit=20&state=active",
			expect.objectContaining({
				headers: expect.objectContaining({ authorization: "Bearer ops-token" }),
				method: "GET",
			}),
		);
	});

	it("forwards actor and idempotency metadata for commands", async () => {
		const result = {
			expiresAt: "2026-07-20T00:00:00.000Z",
			issuedAt: "2026-07-19T00:00:00.000Z",
			temporaryPassword: "temporary-secret",
		};
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(result), {
				headers: { "content-type": "application/json" },
				status: 200,
			}),
		);
		const client = createAccountAdminClient(
			{ OPS_WEB_APP_API_URL: "https://app-api.internal", OPS_WEB_INTERNAL_TOKEN: "ops-token" },
			{ fetchImplementation },
		);
		await expect(
			client.commandUser(
				"user_1",
				"temporary-password",
				{ reason: "Account recovery" },
				"operator@example.test",
				"temporary-password-1",
			),
		).resolves.toEqual(result);
		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://app-api.internal/api/internal/admin/users/user_1/temporary-password",
			expect.objectContaining({
				headers: expect.objectContaining({
					"idempotency-key": "temporary-password-1",
					"x-ops-actor-id": "operator@example.test",
				}),
				method: "POST",
			}),
		);
	});
});
