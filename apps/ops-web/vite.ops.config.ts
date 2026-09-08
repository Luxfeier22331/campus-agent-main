import { resolve } from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
	build: {
		outDir: "dist-ops",
		rollupOptions: {
			input: {
				"db/bootstrap-dining": resolve(import.meta.dirname, "ops/db/bootstrap-dining.ts"),
				"db/bootstrap-transport": resolve(import.meta.dirname, "ops/db/bootstrap-transport.ts"),
				"db/ops-web-database": resolve(import.meta.dirname, "ops/db/ops-web-database.ts"),
				"internal-portal-check": resolve(import.meta.dirname, "ops/internal-portal-check.ts"),
			},
			output: {
				// Preserve the source entry depth for the operational entrypoints.
				entryFileNames: "[name].js",
			},
		},
		ssr: true,
	},
	ssr: {
		noExternal: ["@campus-agent/dining"],
	},
});
