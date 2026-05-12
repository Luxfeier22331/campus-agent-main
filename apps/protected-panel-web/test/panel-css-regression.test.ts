import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const stylesSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

describe("protected panel css regression", () => {
	it("uses dynamic viewport units for the boot placeholder", () => {
		expect(stylesSource).toContain("min-height: 100dvh");
		expect(stylesSource).not.toContain("min-height: 100vh");
	});
});
