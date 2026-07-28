import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";

const userDetail = {
	accessSource: "campus_email" as const,
	accessState: "allowed" as const,
	activeSessionCount: 1,
	banReason: null,
	createdAt: new Date("2026-07-19T00:00:00.000Z"),
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
	updatedAt: new Date("2026-07-19T00:00:00.000Z"),
};

function commandHeaders(idempotencyKey: string) {
	return {
		authorization: "Bearer ops-admin-token",
		"content-type": "application/json",
		"idempotency-key": idempotencyKey,
		"x-ops-actor-id": "operator@example.test",
	};
}

function createTestApp() {
	const accountAdminService = {
		banUser: vi.fn().mockResolvedValue(userDetail),
		getUser: vi.fn().mockResolvedValue(userDetail),
		issueTemporaryPassword: vi.fn().mockResolvedValue({
			expiresAt: new Date("2026-07-20T00:00:00.000Z"),
			issuedAt: new Date("2026-07-19T00:00:00.000Z"),
			temporaryPassword: "temporary-secret",
		}),
		listDeletions: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
		listEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
		listUsers: vi.fn().mockResolvedValue({ items: [userDetail], nextCursor: null }),
		retryDeletion: vi.fn().mockResolvedValue(undefined),
		revokeSession: vi.fn().mockResolvedValue({ ...userDetail, activeSessionCount: 0 }),
		revokeUserSessions: vi.fn().mockResolvedValue({ ...userDetail, activeSessionCount: 0 }),
		sendPasswordResetEmail: vi.fn().mockResolvedValue(userDetail),
		sendVerificationEmail: vi.fn().mockResolvedValue(userDetail),
		unbanUser: vi.fn().mockResolvedValue(userDetail),
	};
	const dispatchPending = vi.fn().mockResolvedValue({ completed: 0, failed: 0, processed: 0 });
	const app = createApp(
		{
			APP_API_ENVIRONMENT: "test",
			OPS_WEB_INTERNAL_TOKEN: "ops-admin-token",
		} as never,
		{
			accountAdminService: accountAdminService as never,
			accountLifecycleService: { dispatchPending, requestDeletion: vi.fn() },
		},
	);
	return { accountAdminService, app, dispatchPending };
}

describe("account admin routes", () => {
	it("requires the Ops Web internal token", async () => {
		const { app } = createTestApp();
		const response = await app.request("http://app.test/api/internal/admin/users");
		expect(response.status).toBe(401);
	});

	it("lists and filters users", async () => {
		const { accountAdminService, app } = createTestApp();
		const response = await app.request(
			"http://app.test/api/internal/admin/users?access=allowed&limit=20&query=student&state=active",
			{ headers: { authorization: "Bearer ops-admin-token" } },
		);
		expect(response.status).toBe(200);
		expect(accountAdminService.listUsers).toHaveBeenCalledWith({
			access: "allowed",
			limit: 20,
			query: "student",
			state: "active",
		});
		expect(await response.json()).toMatchObject({ items: [{ id: "user_1" }] });
	});

	it("lists account events with bounded filters", async () => {
		const { accountAdminService, app } = createTestApp();
		const response = await app.request(
			"http://app.test/api/internal/admin/account-events?window=30d&outcome=failed&actorId=operator%40example.test&targetUserId=user_1&action=account_banned&limit=20",
			{ headers: { authorization: "Bearer ops-admin-token" } },
		);
		expect(response.status).toBe(200);
		expect(accountAdminService.listEvents).toHaveBeenCalledWith({
			action: "account_banned",
			actorId: "operator@example.test",
			limit: 20,
			outcome: "failed",
			targetUserId: "user_1",
			window: "30d",
		});
		expect(response.headers.get("cache-control")).toContain("no-store");
	});

	it("forwards audited user and session commands", async () => {
		const { accountAdminService, app } = createTestApp();
		const ban = await app.request("http://app.test/api/internal/admin/users/user_1/ban", {
			body: JSON.stringify({ reason: "Policy violation" }),
			headers: commandHeaders("ban-user-1"),
			method: "POST",
		});
		expect(ban.status).toBe(200);
		expect(accountAdminService.banUser).toHaveBeenCalledWith({
			actorId: "operator@example.test",
			idempotencyKey: "ban-user-1",
			reason: "Policy violation",
			userId: "user_1",
		});

		const revoke = await app.request(
			"http://app.test/api/internal/admin/users/user_1/sessions/session_1/revoke",
			{
				body: "{}",
				headers: commandHeaders("revoke-session-1"),
				method: "POST",
			},
		);
		expect(revoke.status).toBe(200);
		expect(accountAdminService.revokeSession).toHaveBeenCalledWith({
			actorId: "operator@example.test",
			idempotencyKey: "revoke-session-1",
			sessionId: "session_1",
			userId: "user_1",
		});
	});

	it("returns a newly issued temporary password only in the command response", async () => {
		const { app } = createTestApp();
		const response = await app.request(
			"http://app.test/api/internal/admin/users/user_1/temporary-password",
			{
				body: JSON.stringify({ reason: "Account recovery" }),
				headers: commandHeaders("temporary-password-1"),
				method: "POST",
			},
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ temporaryPassword: "temporary-secret" });
		expect(response.headers.get("cache-control")).toContain("no-store");
	});

	it("accepts an audited deletion retry", async () => {
		const { accountAdminService, app } = createTestApp();
		const response = await app.request(
			"http://app.test/api/internal/admin/account-deletions/acctdel_1/retry",
			{
				body: JSON.stringify({ reason: "Dependency recovered" }),
				headers: commandHeaders("retry-deletion-1"),
				method: "POST",
			},
		);
		expect(response.status).toBe(202);
		expect(accountAdminService.retryDeletion).toHaveBeenCalledWith({
			actorId: "operator@example.test",
			idempotencyKey: "retry-deletion-1",
			reason: "Dependency recovered",
			requestId: "acctdel_1",
		});
	});
});
