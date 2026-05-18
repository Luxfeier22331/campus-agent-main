import { describe, expect, it } from "vitest";

import { resolvePublicChatManualChunk } from "../config/build-chunks";

describe("public chat build chunks", () => {
	it("keeps React runtime out of editor vendor chunks", () => {
		expect(
			resolvePublicChatManualChunk("/repo/apps/public-chat-web/node_modules/react/index.js"),
		).toBe("vendor-react");
		expect(
			resolvePublicChatManualChunk("/repo/apps/public-chat-web/node_modules/react-dom/client.js"),
		).toBe("vendor-react");
	});

	it("keeps heavy editor packages in dedicated async vendor chunks", () => {
		expect(
			resolvePublicChatManualChunk(
				"/repo/apps/public-chat-web/node_modules/prosemirror-view/dist/index.js",
			),
		).toBe("vendor-editor-prosemirror");
		expect(
			resolvePublicChatManualChunk(
				"/repo/apps/public-chat-web/node_modules/@codemirror/view/dist/index.js",
			),
		).toBe("vendor-editor-codemirror");
	});

	it("leaves the sheet grid package on the lazy sheet editor chunk path", () => {
		expect(
			resolvePublicChatManualChunk(
				"/repo/apps/public-chat-web/node_modules/react-data-grid/lib/bundle.js",
			),
		).toBeUndefined();
	});

	it("leaves non-editor packages on the default chunking path", () => {
		expect(
			resolvePublicChatManualChunk(
				"/repo/apps/public-chat-web/node_modules/framer-motion/dist/es/index.mjs",
			),
		).toBeUndefined();
	});
});
