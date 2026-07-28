// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createOpsApp } from "../src/server/app";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";

const grant = {
	accessExpiresAt: null,
	claimExpiresAt: "2026-07-26T00:00:00.000Z",
	claimedAt: null,
	createdAt: "2026-07-19T00:00:00.000Z",
	createdBy: "ops@example.test",
	email: "invitee@example.com",
	environment: "staging" as const,
	id: "019bf4a2-4637-7000-8000-000000000001",
	kind: "invitation" as const,
	lastInvitationSentAt: null,
	revokedAt: null,
	revokedBy: null,
	state: "pending" as const,
	updatedAt: "2026-07-19T00:00:00.000Z",
	userId: null,
};

describe("ops email access BFF", () => {
	it("returns grants to an admitted operator", async () => {
		const command = vi.fn();
		const app = createOpsApp({
			admission: createAllowAllOpsAdmission({ email: "ops@example.test" }),
			emailAccessClient: {
				command,
				list: async () => ({ environment: "staging" as const, items: [grant], nextCursor: null }),
			},
			env: { OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test" },
		});
		const read = await app.request("http://ops.test/api/ops/email-access-grants");
		expect(read.status).toBe(200);
		expect(await read.json()).toMatchObject({ items: [{ email: grant.email }] });
		expect(command).not.toHaveBeenCalled();
	});

	it("forwards allowlisted same-origin commands with actor and idempotency", async () => {
		const command = vi.fn().mockResolvedValue(grant);
		const app = createOpsApp({
			admission: createAllowAllOpsAdmission({ email: "ops@example.test" }),
			emailAccessClient: {
				command,
				list: async () => ({ environment: "staging" as const, items: [], nextCursor: null }),
			},
			env: { OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test" },
		});
		const response = await app.request("http://ops.test/api/ops/email-access-grants", {
			body: JSON.stringify({ email: grant.email, kind: grant.kind }),
			headers: {
				"content-type": "application/json",
				"idempotency-key": "invite-1",
				origin: "https://ops.example.test",
			},
			method: "POST",
		});
		expect(response.status).toBe(201);
		expect(command).toHaveBeenCalledWith(
			"",
			{ email: grant.email, kind: grant.kind },
			"ops@example.test",
			"invite-1",
		);
	});
});
