import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const protectedPanelRoot = new URL("../src/panel/", import.meta.url);

async function readPanelFile(relativePath: string) {
	return readFile(new URL(relativePath, protectedPanelRoot), "utf8");
}

describe("protected panel page load effects", () => {
	it("does not keep overview loading on useEffectEvent-driven fetch loops", async () => {
		const source = await readPanelFile("pages/overview-page.tsx");

		expect(source).not.toContain("useEffectEvent");
	});

	it("does not keep request detail loading on useEffectEvent-driven fetch loops", async () => {
		const source = await readPanelFile("requests/request-show.tsx");

		expect(source).not.toContain("useEffectEvent");
	});
});
