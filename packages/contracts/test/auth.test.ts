import { CAMPUS_PASSWORD_MAX_LENGTH, CAMPUS_PASSWORD_MIN_LENGTH } from "campus-contracts/auth";
import { describe, expect, it } from "vitest";

describe("campus authentication policy", () => {
	it("keeps the published password length contract at eight through 128 characters", () => {
		expect(CAMPUS_PASSWORD_MIN_LENGTH).toBe(8);
		expect(CAMPUS_PASSWORD_MAX_LENGTH).toBe(128);
	});
});
