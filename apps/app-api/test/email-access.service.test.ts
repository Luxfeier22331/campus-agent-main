import { describe, expect, it, vi } from "vitest";

import { buildEmailAccessService, type EmailAccessGrantStore } from "../src/modules/email-access";

function createStore(overrides: Partial<EmailAccessGrantStore> = {}): EmailAccessGrantStore {
	return {
		claim: vi.fn().mockResolvedValue(null),
		create: vi.fn(),
		expire: vi.fn().mockResolvedValue({ expired: 0, purged: 0 }),
		findAccountGrant: vi.fn().mockResolvedValue(null),
		findEmailGrant: vi.fn().mockResolvedValue(null),
		get: vi.fn().mockResolvedValue(null),
		list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
		markInvitationSent: vi.fn().mockResolvedValue(null),
		revoke: vi.fn().mockResolvedValue(null),
		revokeSuperseded: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

describe("email access service", () => {
	it("admits verified active campus accounts without a grant lookup", async () => {
		const store = createStore();
		const service = buildEmailAccessService({ environment: "production", store });
		await expect(
			service.evaluateAccountAccess({
				email: "student@muc.edu.cn",
				emailVerified: true,
				id: "user-1",
			}),
		).resolves.toEqual({ allowed: true, source: "campus_email" });
		expect(store.findAccountGrant).not.toHaveBeenCalled();
	});

	it("requires an active grant bound to the exact external email and user", async () => {
		const findAccountGrant = vi.fn().mockResolvedValue({ id: "grant-1" });
		const service = buildEmailAccessService({
			environment: "staging",
			store: createStore({ findAccountGrant }),
		});
		await expect(
			service.evaluateAccountAccess({
				email: "Person@Example.com",
				emailVerified: true,
				id: "user-1",
			}),
		).resolves.toEqual({ allowed: true, source: "email_grant" });
		expect(findAccountGrant).toHaveBeenCalledWith(
			expect.objectContaining({
				email: "person@example.com",
				environment: "staging",
				userId: "user-1",
			}),
		);
	});

	it("never creates test grants in production", async () => {
		const service = buildEmailAccessService({ environment: "production", store: createStore() });
		await expect(
			service.createGrant({
				actorId: "ops@example.test",
				email: "tester@example.com",
				idempotencyKey: "test-1",
				kind: "test",
			}),
		).rejects.toMatchObject({ code: "test_grant_forbidden", status: 400 });
	});

	it("claims an external grant and revokes superseded grants", async () => {
		const claim = vi.fn().mockResolvedValue({ id: "grant-1" });
		const revokeSuperseded = vi.fn().mockResolvedValue(undefined);
		const service = buildEmailAccessService({
			environment: "staging",
			store: createStore({ claim, revokeSuperseded }),
		});
		await expect(
			service.claimVerifiedUser({
				email: "tester@example.com",
				emailVerified: true,
				id: "user-1",
			}),
		).resolves.toEqual({ allowed: true, source: "email_grant" });
		expect(claim).toHaveBeenCalledOnce();
		expect(revokeSuperseded).toHaveBeenCalledOnce();
	});
});
