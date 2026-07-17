import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { resolveStagingSentryRelease } from "../../scripts/deploy/staging-release";
import { campusBundleGraphPlugin } from "./config/bundle-graph";

const require = createRequire(import.meta.url);
const sharedFaviconPath = path.resolve(__dirname, "../../configs/branding/web-public/favicon.ico");

export default defineConfig(() => {
	const sentryUpload = resolveSentrySourceMapUpload();
	return {
		build: {
			sourcemap: sentryUpload ? ("hidden" as const) : false,
		},
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
			...(sentryUpload
				? sentryVitePlugin({
						authToken: sentryUpload.authToken,
						org: sentryUpload.org,
						project: sentryUpload.project,
						url: "https://sentry.io",
						release: {
							create: true,
							finalize: true,
							inject: true,
							name: sentryUpload.release,
							setCommits: { auto: true },
						},
						sourcemaps: {
							assets: "./dist/client/**",
							filesToDeleteAfterUpload: "./dist/client/**/*.map",
						},
						telemetry: false,
					})
				: []),
		],
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "src"),
			},
			dedupe: ["react", "react-dom"],
		},
	};
});

function resolveSentrySourceMapUpload(): {
	authToken: string;
	org: string;
	project: string;
	release: string;
} | null {
	if (process.env.CAMPUS_WEB_SENTRY_SOURCE_MAP_UPLOAD !== "required") {
		return null;
	}
	if (process.env.SENTRY_ALLOW_FAILURE?.trim()) {
		throw new Error("SENTRY_ALLOW_FAILURE must be unset for the campus staging source-map upload.");
	}
	const required = {
		SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN?.trim(),
		SENTRY_CAMPUS_WEB_PROJECT_SLUG: process.env.SENTRY_CAMPUS_WEB_PROJECT_SLUG?.trim(),
		SENTRY_ORG_SLUG: process.env.SENTRY_ORG_SLUG?.trim(),
	};
	const missing = Object.entries(required)
		.filter(([, value]) => !value)
		.map(([key]) => key);
	if (missing.length > 0) {
		throw new Error(`Campus browser source-map upload is missing: ${missing.join(", ")}.`);
	}
	return {
		authToken: required.SENTRY_AUTH_TOKEN as string,
		org: required.SENTRY_ORG_SLUG as string,
		project: required.SENTRY_CAMPUS_WEB_PROJECT_SLUG as string,
		release: resolveStagingSentryRelease("campus-web"),
	};
}

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
