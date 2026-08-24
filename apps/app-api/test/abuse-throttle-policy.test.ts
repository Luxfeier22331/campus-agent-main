import { expect, it } from "vitest";

import { isAbuseThrottleEnabled } from "../src/modules/abuse-throttle-policy";

it.each([
	["development", false],
	["test", true],
	["staging", true],
	["production", true],
] as const)("abuse throttle for %s is %s", (environment, expected) => {
	expect(isAbuseThrottleEnabled(environment)).toBe(expected);
});
