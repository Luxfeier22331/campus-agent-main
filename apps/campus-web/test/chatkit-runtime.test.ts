import { afterEach, describe, expect, it } from "vitest";

import {
	CHATKIT_RUNTIME_SCRIPT_URL,
	loadChatKitRuntime,
} from "../src/features/conversation/chatkit-runtime";

describe("ChatKit runtime loader", () => {
	afterEach(() => {
		document.querySelectorAll('script[data-campus-chatkit-runtime="true"]').forEach((script) => {
			script.remove();
		});
	});

	it("defaults to the self-hosted same-origin runtime", () => {
		expect(CHATKIT_RUNTIME_SCRIPT_URL).toBe("/vendor/openai-chatkit/2026-06-17/chatkit.js");
	});

	it("reuses an already loaded same-origin runtime script", async () => {
		const script = document.createElement("script");
		script.dataset.campusChatkitRuntime = "true";
		script.dataset.campusChatkitRuntimeState = "loaded";
		script.src = new URL(CHATKIT_RUNTIME_SCRIPT_URL, window.location.href).href;
		document.head.appendChild(script);

		await expect(loadChatKitRuntime()).resolves.toBeUndefined();

		expect(document.querySelectorAll('script[data-campus-chatkit-runtime="true"]')).toHaveLength(1);
	});
});
