import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const require = createRequire(import.meta.url);

export default defineConfig({
	publicDir: path.resolve(__dirname, "public"),
	plugins: [
		tailwindcss(),
		react(),
		copyMapLibreVendor(),
		cloudflare({
			inspectorPort: false,
		}),
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
});

function copyMapLibreVendor(): Plugin {
	return {
		apply: "build",
		closeBundle() {
			const packageJsonPath = require.resolve("maplibre-gl/package.json");
			const sourceDir = path.join(path.dirname(packageJsonPath), "dist");
			const targetDir = path.resolve(__dirname, "dist/client/vendor/maplibre-gl");
			fs.mkdirSync(targetDir, { recursive: true });
			for (const fileName of ["maplibre-gl.js", "maplibre-gl.css", "LICENSE.txt"]) {
				fs.copyFileSync(path.join(sourceDir, fileName), path.join(targetDir, fileName));
			}
		},
		name: "campus-web:copy-maplibre-vendor",
	};
}
