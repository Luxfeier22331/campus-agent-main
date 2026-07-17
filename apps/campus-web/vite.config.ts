import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { campusBundleGraphPlugin } from "./config/bundle-graph";

const require = createRequire(import.meta.url);
const sharedFaviconPath = path.resolve(__dirname, "../../configs/branding/web-public/favicon.ico");

export default defineConfig({
	publicDir: path.resolve(__dirname, "public"),
	plugins: [
		tailwindcss(),
		react(),
		campusBundleGraphPlugin({
			outputFile: path.resolve(__dirname, ".generated/bundle-graph.json"),
		}),
		copySharedFavicon(),
		copyMapLibreVendor(),
		cloudflare({
			inspectorPort: false,
		}),
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
		dedupe: ["react", "react-dom"],
	},
});

function copySharedFavicon(): Plugin {
	return {
		closeBundle() {
			const targetPath = path.resolve(__dirname, "dist/client/favicon.ico");
			fs.mkdirSync(path.dirname(targetPath), { recursive: true });
			fs.copyFileSync(sharedFaviconPath, targetPath);
		},
		configureServer(server) {
			server.middlewares.use("/favicon.ico", (_request, response, next) => {
				response.setHeader("content-type", "image/x-icon");
				fs.createReadStream(sharedFaviconPath).on("error", next).pipe(response);
			});
		},
		name: "campus-web:copy-shared-favicon",
	};
}

function copyMapLibreVendor(): Plugin {
	const vendorFiles = new Map([
		["maplibre-gl.js", "text/javascript; charset=utf-8"],
		["maplibre-gl.css", "text/css; charset=utf-8"],
		["LICENSE.txt", "text/plain; charset=utf-8"],
	]);

	function getVendorSourceDir() {
		const packageJsonPath = require.resolve("maplibre-gl/package.json");
		return path.join(path.dirname(packageJsonPath), "dist");
	}

	return {
		closeBundle() {
			const sourceDir = getVendorSourceDir();
			const targetDir = path.resolve(__dirname, "dist/client/vendor/maplibre-gl");
			fs.mkdirSync(targetDir, { recursive: true });
			for (const fileName of vendorFiles.keys()) {
				fs.copyFileSync(path.join(sourceDir, fileName), path.join(targetDir, fileName));
			}
		},
		configureServer(server) {
			server.middlewares.use("/vendor/maplibre-gl", (request, response, next) => {
				const fileName = path.basename(request.url?.split("?")[0] ?? "");
				const contentType = vendorFiles.get(fileName);
				if (!contentType) {
					next();
					return;
				}

				const filePath = path.join(getVendorSourceDir(), fileName);
				response.setHeader("content-type", contentType);
				fs.createReadStream(filePath).on("error", next).pipe(response);
			});
		},
		name: "campus-web:copy-maplibre-vendor",
	};
}
