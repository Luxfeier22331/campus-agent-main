import { describe, expect, it } from "vitest";
import { InternalPortalCredentialResolutionSchema } from "../src/internal-portal-credential";

describe("internal portal credential resolution contract", () => {
	it("accepts the versioned plaintext response", () => {
		expect(
			InternalPortalCredentialResolutionSchema.safeParse({
				schemaVersion: "internal-portal-credential-resolution.v1",
				ssoTgc: "TGT-resolved",
			}).success,
		).toBe(true);
	});

	it("rejects empty credentials and extra fields", () => {
		expect(
			InternalPortalCredentialResolutionSchema.safeParse({
				schemaVersion: "internal-portal-credential-resolution.v1",
				ssoTgc: "",
			}).success,
		).toBe(false);
		expect(
			InternalPortalCredentialResolutionSchema.safeParse({
				schemaVersion: "internal-portal-credential-resolution.v1",
				ssoTgc: "TGT-resolved",
				unexpected: true,
			}).success,
		).toBe(false);
	});
});
