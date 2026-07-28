// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createOpsApp } from "../src/server/app";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";

const user = {
	activeSessionCount: 0,
	banReason: null,
	createdAt: "2026-07-19T00:00:00.000Z",
	credentialAccount: true,
	deletion: null,
	email: "student@muc.edu.cn",
	emailVerified: true,
	events: [],
	id: "user_1",
	name: "Student",
	passwordChangeRequired: false,
	sessions: [],
	state: "active" as const,
	temporaryPasswordExpiresAt: null,
	updatedAt: "2026-07-19T00:00:00.000Z",
};

function createTestApp() {
	const accountAdminClient = {
		commandUser: vi.fn().mockResolvedValue({
			expiresAt: "2026-07-20T00:00:00.000Z",
			issuedAt: "2026-07-19T00:00:00.000Z",
			temporaryPassword: "temporary-secret",
		}),
		getUser: vi.fn().mockResolvedValue(user),
		listDeletions: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
		listEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
		listUsers: vi.fn().mockResolvedValue({ items: [user], nextCursor: null }),
		retryDeletion: vi.fn().mockResolvedValue({ accepted: true }),
		revokeSession: vi.fn().mockResolvedValue(user),
	};
	const app = createOpsApp({
		accountAdminClient,
		admission: createAllowAllOpsAdmission({
			email: "operator@example.test",
			operatorId: "operator@example.test",
		}),
		env: { OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test" },
	});
	return { accountAdminClient, app };
}

describe("ops account administration BFF", () => {
	it("returns user pages to an admitted operator", async () => {
		const { accountAdminClient, app } = createTestApp();
		const response = await app.request("http://ops.test/api/ops/users?state=active&limit=20");
		expect(response.status).toBe(200);
		expect(accountAdminClient.listUsers).toHaveBeenCalledWith(expect.objectContaining({ size: 2 }));
		expect(await response.json()).toMatchObject({ items: [{ id: "user_1" }] });
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("forwards account event filters to App API", async () => {
		const { accountAdminClient, app } = createTestApp();
		const response = await app.request(
			"http://ops.test/api/ops/account-events?window=30d&outcome=failed&targetUserId=user_1",
		);
		expect(response.status).toBe(200);
		expect(accountAdminClient.listEvents).toHaveBeenCalledWith(
			expect.objectContaining({ size: 4 }),
		);
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("forwards same-origin commands with the Access operator and idempotency key", async () => {
		const { accountAdminClient, app } = createTestApp();
		const response = await app.request("http://ops.test/api/ops/users/user_1/temporary-password", {
			body: JSON.stringify({ reason: "Account recovery" }),
			headers: {
				"content-type": "application/json",
				"idempotency-key": "temporary-password-1",
				origin: "https://ops.example.test",
			},
			method: "POST",
		});
		expect(response.status).toBe(200);
		expect(accountAdminClient.commandUser).toHaveBeenCalledWith(
			"user_1",
			"temporary-password",
			{ reason: "Account recovery" },
			"operator@example.test",
			"temporary-password-1",
		);
		expect(await response.json()).toMatchObject({ temporaryPassword: "temporary-secret" });
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("rejects cross-origin account commands", async () => {
		const { accountAdminClient, app } = createTestApp();
		const response = await app.request("http://ops.test/api/ops/users/user_1/ban", {
			body: JSON.stringify({ reason: "Policy violation" }),
			headers: {
				"content-type": "application/json",
				"idempotency-key": "ban-user-1",
				origin: "https://attacker.example",
			},
			method: "POST",
		});
		expect(response.status).toBe(403);
		expect(accountAdminClient.commandUser).not.toHaveBeenCalled();
	});

	it("forwards deletion retries as audited commands", async () => {
		const { accountAdminClient, app } = createTestApp();
		const response = await app.request(
			"http://ops.test/api/ops/account-deletions/acctdel_1/retry",
			{
				body: JSON.stringify({ reason: "Dependency recovered" }),
				headers: {
					"content-type": "application/json",
					"idempotency-key": "retry-1",
					origin: "https://ops.example.test",
				},
				method: "POST",
			},
		);
		expect(response.status).toBe(202);
		expect(accountAdminClient.retryDeletion).toHaveBeenCalledWith(
			"acctdel_1",
			{ reason: "Dependency recovered" },
			"operator@example.test",
			"retry-1",
		);
	});
});
