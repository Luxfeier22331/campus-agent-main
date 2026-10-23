import { describe, expect, it } from "vitest";

import { assertCampusUserEligible, evaluateCampusAccess } from "../src/modules/auth/campus-access";
import { mapSessionToCampusMemberPrincipal } from "../src/modules/auth/principal";
import { isCampusEmail, normalizeCampusEmail } from "../src/modules/email-access/campus-email";

describe("campus email access", () => {
	it.each([
		["student@muc.edu.cn", true],
		[" Student@MUC.EDU.CN ", true],
		["student@sub.muc.edu.cn", false],
		["student@muc.edu.cn.example.com", false],
		["student@outlook.com", false],
		["student@@muc.edu.cn", false],
	])("checks the exact campus domain for %s", (email, expected) => {
		expect(isCampusEmail(email)).toBe(expected);
	});

	it("normalizes only structurally valid email values", () => {
		expect(normalizeCampusEmail(" Student@MUC.EDU.CN ")).toBe("student@muc.edu.cn");
		expect(normalizeCampusEmail("student@@muc.edu.cn")).toBeNull();
		expect(normalizeCampusEmail("@muc.edu.cn")).toBeNull();
		expect(normalizeCampusEmail("student@")).toBeNull();
		expect(normalizeCampusEmail(null)).toBeNull();
	});

	it("requires a verified, unblocked account", () => {
		expect(
			evaluateCampusAccess({
				email: "student@muc.edu.cn",
				emailVerified: true,
			}),
		).toEqual({ allowed: true });
		expect(
			evaluateCampusAccess({
				email: "student@muc.edu.cn",
				emailVerified: false,
			}),
		).toEqual({ allowed: false, reason: "email_not_verified" });
		expect(
			evaluateCampusAccess({
				banned: true,
				email: "student@muc.edu.cn",
				emailVerified: true,
			}),
		).toEqual({ allowed: false, reason: "account_banned" });
	});

	it("uses stable auth error codes", () => {
		expect(() =>
			assertCampusUserEligible({
				email: "student@muc.edu.cn",
				emailVerified: false,
			}),
		).toThrow(
			expect.objectContaining({ body: expect.objectContaining({ code: "EMAIL_NOT_VERIFIED" }) }),
		);
	});

	it("does not project an ineligible Better Auth session as a campus member", () => {
		const session = {
			session: { expiresAt: new Date("2026-07-20T00:00:00.000Z"), id: "session_1" },
			user: {
				email: "student@muc.edu.cn",
				emailVerified: true,
				id: "user_1",
				name: "Student",
			},
		};
		expect(mapSessionToCampusMemberPrincipal(session)?.permissions.chat).toBe(true);
		expect(
			mapSessionToCampusMemberPrincipal({
				...session,
				user: { ...session.user, emailVerified: false },
			}),
		).toBeNull();
		expect(
			mapSessionToCampusMemberPrincipal({
				...session,
				user: { ...session.user, banned: true },
			}),
		).toBeNull();
	});
});
