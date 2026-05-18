import { describe, expect, it } from "vitest";

import { checkPublicChatBuildBudgetSnapshot } from "../config/build-budget";

describe("public chat build budget", () => {
	it("passes when editor vendor chunks are async-only and within budget", () => {
		expect(
			checkPublicChatBuildBudgetSnapshot({
				assets: [
					{ fileName: "assets/text-editor-demo.js", byteLength: 12_000 },
					{ fileName: "assets/sheet-editor-demo.js", byteLength: 60_000 },
					{ fileName: "assets/vendor-editor-codemirror-demo.js", byteLength: 450_000 },
					{ fileName: "assets/vendor-editor-prosemirror-demo.js", byteLength: 350_000 },
				],
				indexHtml: '<script type="module" src="/assets/app.js"></script>',
			}),
		).toMatchObject({
			checkedEditorChunkCount: 4,
			ok: true,
		});
	});

	it("fails when editor vendor chunks are preloaded by the app shell html", () => {
		expect(() =>
			checkPublicChatBuildBudgetSnapshot({
				assets: [],
				indexHtml: '<link rel="modulepreload" href="/assets/vendor-editor-table-demo.js">',
			}),
		).toThrow("public chat app shell must not preload editor-only chunk");
	});

	it("fails when an editor chunk exceeds the configured budget", () => {
		expect(() =>
			checkPublicChatBuildBudgetSnapshot({
				assets: [{ fileName: "assets/vendor-editor-codemirror-demo.js", byteLength: 600_001 }],
				indexHtml: '<script type="module" src="/assets/app.js"></script>',
				maxEditorVendorChunkBytes: 600_000,
			}),
		).toThrow("public chat editor chunk exceeds budget");
	});
});
