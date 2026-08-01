import { resolve } from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
	build: {
		outDir: "dist-ops",
		rollupOptions: {
			input: {
				"db/bootstrap-dining": resolve(import.meta.dirname, "ops/db/bootstrap-dining.ts"),
				"db/ops-web-database": resolve(import.meta.dirname, "ops/db/ops-web-database.ts"),
				"internal-portal/check": resolve(
					import.meta.dirname,
					"src/server/internal-portal-check.ts",
				),
			},
			output: {
				// Preserve the source entry depth so ../../drizzle resolves inside the artifact.
				entryFileNames: "[name].js",
			},
		},
		ssr: true,
	},
	ssr: {
		noExternal: ["@campus-agent/dining", "@campus-agent/internal-portal-client"],
	},
});
