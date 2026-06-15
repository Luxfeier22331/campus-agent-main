import { describe, expect, it } from "vitest";

import { operatorConsoleManualChunks } from "../config/manual-chunks";

describe("Operator Console web chunk strategy", () => {
	it("extracts the react-admin entry packages into a dedicated shell chunk", () => {
		expect(
			operatorConsoleManualChunks(
				"/workspace/apps/operator-console-web/node_modules/react-admin/dist/index.js",
			),
		).toBe("react-admin-entry");
		expect(
			operatorConsoleManualChunks(
				"/workspace/apps/operator-console-web/node_modules/ra-language-english/dist/index.js",
			),
		).toBe("react-admin-entry");
	});

	it("extracts ra-core runtime dependencies into a dedicated core chunk", () => {
		expect(
			operatorConsoleManualChunks(
				"/workspace/apps/operator-console-web/node_modules/ra-core/dist/index.js",
			),
		).toBe("ra-core-vendor");
		expect(
			operatorConsoleManualChunks(
				"/workspace/apps/operator-console-web/node_modules/@tanstack/react-query/build/modern/index.js",
			),
		).toBe("ra-core-vendor");
		expect(
			operatorConsoleManualChunks(
				"/workspace/apps/operator-console-web/node_modules/react-hook-form/dist/index.esm.mjs",
			),
		).toBe("ra-core-vendor");
	});

	it("extracts the material-ui admin layer into a dedicated ui chunk", () => {
		expect(
			operatorConsoleManualChunks(
				"/workspace/apps/operator-console-web/node_modules/ra-ui-materialui/dist/index.js",
			),
		).toBe("ra-ui-vendor");
	});

	it("splits mui, emotion, icons, and charts into bounded ui vendor chunks", () => {
		expect(
			operatorConsoleManualChunks(
				"/workspace/apps/operator-console-web/node_modules/@mui/material/Button/Button.js",
			),
		).toBe("mui-material-vendor");
		expect(
			operatorConsoleManualChunks(
				"/workspace/apps/operator-console-web/node_modules/@emotion/react/dist/emotion-react.esm.js",
			),
		).toBe("mui-system-vendor");
		expect(
			operatorConsoleManualChunks(
				"/workspace/apps/operator-console-web/node_modules/@mui/icons-material/Menu.js",
			),
		).toBe("mui-icons-vendor");
		expect(
			operatorConsoleManualChunks(
				"/workspace/apps/operator-console-web/node_modules/@mui/x-charts/LineChart/index.js",
			),
		).toBe("mui-x-vendor");
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
