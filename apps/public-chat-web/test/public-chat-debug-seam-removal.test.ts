import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import appRouterSource from "../src/routes/app-router.tsx?raw";

describe("public chat debug seam removal", () => {
	it("does not keep the temporary /chat/replatform-preview seam or legacy shell directories", () => {
		expect(appRouterSource).not.toContain("/chat/replatform-preview");
		expect(appRouterSource).not.toContain("ChatbotShellPreviewPage");
		expect(appRouterSource).not.toContain("preview-page");
		expect(existsSync(new URL("../src/chatbot-shell", import.meta.url))).toBe(false);
		expect(existsSync(new URL("../src/chatbot-donor", import.meta.url))).toBe(false);
	});
});
