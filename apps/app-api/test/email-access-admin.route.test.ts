import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";

const grant = {
	accessExpiresAt: null,
	claimExpiresAt: new Date("2099-07-26T00:00:00.000Z"),
	claimedAt: null,
	createdAt: new Date("2026-07-19T00:00:00.000Z"),
	createdBy: "ops@example.test",
	email: "invitee@example.com",
	environment: "test" as const,
	id: "019bf4a2-4637-7000-8000-000000000001",
	kind: "invitation" as const,
	lastInvitationSentAt: null,
	revokedAt: null,
	revokedBy: null,
	state: "pending" as const,
	updatedAt: new Date("2026-07-19T00:00:00.000Z"),
	userId: null,
};

function createTestApp() {
	const revokeGrant = vi.fn().mockResolvedValue({
		...grant,
		revokedAt: new Date("2026-07-19T01:00:00.000Z"),
		revokedBy: "ops@example.test",
		state: "revoked",
	});
	const app = createApp(
		{
			APP_API_ENVIRONMENT: "test",
			OPS_WEB_INTERNAL_TOKEN: "ops-admin-token",
		} as never,
		{
			emailAccessService: {
				getGrant: vi.fn().mockResolvedValue(grant),
				listGrants: vi.fn().mockResolvedValue({ items: [grant], nextCursor: null }),
				revokeGrant,
			} as never,
		},
	);
	return { app, revokeGrant };
}

describe("email access admin routes", () => {
	it("requires the Ops Web internal token", async () => {
		const { app } = createTestApp();
		const response = await app.request("http://app.test/api/internal/admin/email-access-grants");
		expect(response.status).toBe(401);
	});

	it("lists the current environment and forwards idempotent revoke commands", async () => {
		const { app, revokeGrant } = createTestApp();
		const list = await app.request("http://app.test/api/internal/admin/email-access-grants", {
			headers: { authorization: "Bearer ops-admin-token" },
		});
		expect(list.status).toBe(200);
		expect(await list.json()).toMatchObject({
			environment: "test",
			items: [{ email: grant.email }],
		});

		const revoke = await app.request(
			`http://app.test/api/internal/admin/email-access-grants/${grant.id}/revoke`,
			{
				body: "{}",
				headers: {
					authorization: "Bearer ops-admin-token",
					"content-type": "application/json",
					"idempotency-key": "revoke-1",
					"x-ops-actor-id": "ops@example.test",
				},
				method: "POST",
			},
		);
		expect(revoke.status).toBe(200);
		expect(revokeGrant).toHaveBeenCalledWith({
			actorId: "ops@example.test",
			grantId: grant.id,
			idempotencyKey: "revoke-1",
		});
	});

	it("records accepted invitation email requests and permits a failed delivery to be resent", async () => {
		const sentGrant = {
			...grant,
			lastInvitationSentAt: new Date("2026-07-19T02:00:00.000Z"),
		};
		const createGrant = vi.fn().mockResolvedValue(grant);
		const getGrant = vi.fn().mockResolvedValueOnce(sentGrant).mockResolvedValue(sentGrant);
		const markInvitationSent = vi.fn().mockResolvedValue(sentGrant);
		const sender = {
			send: vi
				.fn()
				.mockRejectedValueOnce(new Error("mail service unavailable"))
				.mockResolvedValue({ id: "email-1" }),
		};
		const app = createApp(
			{
				APP_API_ENVIRONMENT: "test",
				AUTH_EMAIL_FROM: "Campus Agent <account@auth.muc.wiki>",
				AUTH_SHELL_ORIGIN: "https://campus.example.test",
				AUTH_TURNSTILE_SECRET_KEY: "turnstile-test-key",
				BETTER_AUTH_SECRET: "better-auth-test-secret-better-auth-test-secret",
				OPS_WEB_INTERNAL_TOKEN: "ops-admin-token",
				RESEND_API_KEY: "resend-test-key",
			} as never,
			{
				accessInvitationEmailSender: sender,
				emailAccessService: {
					createGrant,
					getGrant,
					markInvitationSent,
				} as never,
			},
		);
		const headers = {
			authorization: "Bearer ops-admin-token",
			"content-type": "application/json",
			"x-ops-actor-id": "ops@example.test",
		};

		const failed = await app.request("http://app.test/api/internal/admin/email-access-grants", {
			body: JSON.stringify({ email: grant.email, kind: "invitation" }),
			headers: { ...headers, "idempotency-key": "create-1" },
			method: "POST",
		});
		expect(failed.status).toBe(502);
		expect(await failed.json()).toMatchObject({ error: { code: "invitation_delivery_failed" } });
		expect(markInvitationSent).not.toHaveBeenCalled();

		const resent = await app.request(
			`http://app.test/api/internal/admin/email-access-grants/${grant.id}/resend`,
			{
				body: "{}",
				headers: { ...headers, "idempotency-key": "resend-1" },
				method: "POST",
			},
		);
		expect(resent.status).toBe(200);
		expect(await resent.json()).toMatchObject({
			lastInvitationSentAt: "2026-07-19T02:00:00.000Z",
		});
		expect(sender.send).toHaveBeenCalledTimes(2);
		expect(sender.send).toHaveBeenLastCalledWith(expect.objectContaining({ to: grant.email }), {
			idempotencyKey: "resend-1:invitation",
			purpose: "access_invitation",
		});
		expect(markInvitationSent).toHaveBeenCalledWith(grant.id);
	});

	it("does not resend an initial invitation when the create command is replayed", async () => {
		const sentGrant = {
			...grant,
			lastInvitationSentAt: new Date("2026-07-19T02:00:00.000Z"),
		};
		const sender = { send: vi.fn() };
		const app = createApp(
			{
				APP_API_ENVIRONMENT: "test",
				AUTH_EMAIL_FROM: "Campus Agent <account@auth.muc.wiki>",
				AUTH_SHELL_ORIGIN: "https://campus.example.test",
				AUTH_TURNSTILE_SECRET_KEY: "turnstile-test-key",
				BETTER_AUTH_SECRET: "better-auth-test-secret-better-auth-test-secret",
				OPS_WEB_INTERNAL_TOKEN: "ops-admin-token",
				RESEND_API_KEY: "resend-test-key",
			} as never,
			{
				accessInvitationEmailSender: sender,
				emailAccessService: {
					createGrant: vi.fn().mockResolvedValue(sentGrant),
					getGrant: vi.fn().mockResolvedValue(sentGrant),
				} as never,
			},
		);
		const response = await app.request("http://app.test/api/internal/admin/email-access-grants", {
			body: JSON.stringify({ email: grant.email, kind: "invitation" }),
			headers: {
				authorization: "Bearer ops-admin-token",
				"content-type": "application/json",
				"idempotency-key": "create-replay",
				"x-ops-actor-id": "ops@example.test",
			},
			method: "POST",
		});

		expect(response.status).toBe(201);
		expect(sender.send).not.toHaveBeenCalled();
	});
});
