import { resolve } from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
	build: {
		outDir: "dist-ops",
		rollupOptions: {
			input: {
				"bootstrap-dining": resolve(import.meta.dirname, "ops/db/bootstrap-dining.ts"),
				"ops-web-database": resolve(import.meta.dirname, "ops/db/ops-web-database.ts"),
			},
			output: {
				entryFileNames: "[name].js",
			},
		},
		ssr: true,
	},
	ssr: {
		noExternal: ["@campus-agent/dining"],
	},
});
