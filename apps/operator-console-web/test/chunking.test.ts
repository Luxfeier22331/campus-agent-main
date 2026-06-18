import { describe, expect, it } from "vitest";

import { operatorConsoleManualChunks } from "../config/manual-chunks";

describe("Operator Console web chunk strategy", () => {
	it("extracts query packages into a bounded vendor chunk", () => {
		expect(
			operatorConsoleManualChunks(
				"/workspace/apps/operator-console-web/node_modules/@tanstack/react-query/build/modern/index.js",
			),
		).toBe("query-form-vendor");
	});

	it("extracts Radix primitives into their own vendor chunk", () => {
		expect(
			operatorConsoleManualChunks(
				"/workspace/apps/operator-console-web/node_modules/@radix-ui/react-slot/dist/index.mjs",
			),
		).toBe("radix-ui-vendor");
	});

	it("extracts react runtime packages into a dedicated react chunk", () => {
		expect(
			operatorConsoleManualChunks(
				"/workspace/apps/operator-console-web/node_modules/react/index.js",
			),
		).toBe("react-vendor");
		expect(
			operatorConsoleManualChunks(
				"/workspace/apps/operator-console-web/node_modules/react-router-dom/dist/index.js",
			),
		).toBe("react-vendor");
	});

	it("leaves app-local modules to route-level lazy splitting instead of forcing them into a manual chunk", () => {
		expect(
			operatorConsoleManualChunks(
				"/workspace/apps/operator-console-web/src/panel/requests/request-list.tsx",
			),
		).toBeUndefined();
	});
});
