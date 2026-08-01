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
import { resolveDocsContentPaths } from "./src/docs-reader-build/docs-content";

const require = createRequire(import.meta.url);
const sharedFaviconPath = path.resolve(__dirname, "../../configs/branding/web-public/favicon.ico");

export default defineConfig(({ command }) => {
	const buildTarget = resolveCampusWebBuildTarget();
	const sentryUpload = buildTarget === "app" ? resolveSentrySourceMapUpload() : null;
	const docsContent = resolveDocsBuildContent();
	if (buildTarget === "docs" && command !== "build") {
		throw new Error("The Campus Web docs build requires static docs content.");
	}
	const htmlInputs =
		buildTarget === "docs" ? findHtmlInputs(docsContent.paths.pagesRoot) : undefined;
	const clientOutputRoot = path.resolve(
		__dirname,
		buildTarget === "docs" ? "dist/docs-client" : "dist/client",
	);
	return {
		build: {
			sourcemap: sentryUpload ? ("hidden" as const) : false,
			...(buildTarget === "docs" ? { emptyOutDir: true, outDir: clientOutputRoot } : {}),
		},
		environments: {
			client: {
				build: {
					...(htmlInputs ? { rollupOptions: { input: htmlInputs } } : {}),
				},
			},
		},
		publicDir: docsContent.paths.publicRoot,
		plugins: [
			tailwindcss(),
			react(),
			campusBundleGraphPlugin({
				entry: buildTarget,
				outputFile: path.resolve(
					__dirname,
					buildTarget === "docs"
						? ".generated/docs-bundle-graph.json"
						: ".generated/bundle-graph.json",
				),
			}),
			...(buildTarget === "docs"
				? [
						relocateDocsHtmlPages({
							clientOutputRoot,
							pagesRoot: docsContent.paths.pagesRoot,
						}),
					]
				: [copySharedFavicon(), copyMapLibreVendor(), cloudflare({ inspectorPort: false })]),
			...(buildTarget === "app" && command === "serve"
				? [serveDocsDevelopmentShell(docsContent.paths.publicRoot)]
				: []),
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

function resolveCampusWebBuildTarget(): "app" | "docs" {
	const target = process.env.CAMPUS_WEB_BUILD_TARGET?.trim();
	if (!target || target === "app") {
		return "app";
	}
	if (target === "docs") {
		return "docs";
	}
	throw new Error("CAMPUS_WEB_BUILD_TARGET must be app or docs.");
}

function resolveDocsBuildContent(): { paths: ReturnType<typeof resolveDocsContentPaths> } {
	const configuredRoot = process.env.CAMPUS_WEB_DOCS_CONTENT_ROOT?.trim();
	if (!configuredRoot) {
		throw new Error(
			"Campus Web requires prepared docs content. Use pnpm run dev or pnpm run build.",
		);
	}
	return { paths: resolveDocsContentPaths(configuredRoot) };
}

function findHtmlInputs(pagesRoot: string): Record<string, string> {
	const inputs: Record<string, string> = {};
	const docsRoot = path.resolve(pagesRoot);
	if (!fs.existsSync(docsRoot)) {
		throw new Error(`generated docs HTML is missing: ${docsRoot}`);
	}
	const directories = [docsRoot];
	while (directories.length > 0) {
		const directory = directories.pop();
		if (!directory) {
			continue;
		}
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const target = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				directories.push(target);
			} else if (entry.isFile() && entry.name === "index.html") {
				const relative = path.relative(docsRoot, target).replaceAll(path.sep, "/");
				const route = `docs/${relative.slice(0, -".html".length)}`;
				inputs[route] = target;
			}
		}
	}
	const sortedInputs = Object.fromEntries(
		Object.entries(inputs).sort(([left], [right]) => left.localeCompare(right)),
	);
	if (Object.keys(sortedInputs).length === 0) {
		throw new Error(`generated docs HTML is empty: ${docsRoot}`);
	}
	const notFoundPath = path.resolve(docsRoot, "404.html");
	if (!fs.existsSync(notFoundPath)) {
		throw new Error(`generated docs 404 HTML is missing: ${notFoundPath}`);
	}
	return { ...sortedInputs, "docs/404": notFoundPath };
}

function serveDocsDevelopmentShell(publicRoot: string): Plugin {
	const shellPath = path.resolve(__dirname, "docs-dev.html");
	return {
		configureServer(server) {
			server.middlewares.use(async (request, response, next) => {
				const url = new URL(request.url ?? "/", "http://campus.local");
				if (serveDocsDevelopmentAsset({ publicRoot, request, response, url })) {
					return;
				}
				const acceptsHtml = (request.headers.accept ?? "").includes("text/html");
				if (
					(request.method !== "GET" && request.method !== "HEAD") ||
					!acceptsHtml ||
					!(url.pathname === "/docs" || url.pathname.startsWith("/docs/"))
				) {
					next();
					return;
				}
				try {
					const transformed = await server.transformIndexHtml(
						url.pathname,
						fs.readFileSync(shellPath, "utf8"),
					);
					response.statusCode = 200;
					response.setHeader("content-type", "text/html; charset=utf-8");
					response.end(request.method === "HEAD" ? undefined : transformed);
				} catch (error) {
					next(error);
				}
			});
		},
		name: "campus-web:docs-development-shell",
	};
}

export function serveDocsDevelopmentAsset(input: {
	publicRoot: string;
	request: { method?: string };
	response: {
		end: (chunk?: Uint8Array) => void;
		setHeader: (name: string, value: string) => void;
		statusCode: number;
	};
	url: URL;
}): boolean {
	if (
		(input.request.method !== "GET" && input.request.method !== "HEAD") ||
		!input.url.pathname.startsWith("/_docs/")
	) {
		return false;
	}
	const root = path.resolve(input.publicRoot);
	let target: string;
	try {
		target = path.resolve(root, `.${decodeURIComponent(input.url.pathname)}`);
	} catch {
		return serveDocsDevelopmentAssetNotFound(input);
	}
	if (path.relative(root, target).startsWith("..") || !fs.existsSync(target)) {
		return serveDocsDevelopmentAssetNotFound(input);
	}
	const stat = fs.statSync(target);
	if (!stat.isFile()) {
		return serveDocsDevelopmentAssetNotFound(input);
	}
	input.response.statusCode = 200;
	input.response.setHeader("content-type", docsDevelopmentAssetContentType(target));
	input.response.setHeader("content-length", String(stat.size));
	if (input.request.method === "HEAD") {
		input.response.end();
		return true;
	}
	input.response.end(fs.readFileSync(target));
	return true;
}

function serveDocsDevelopmentAssetNotFound(input: {
	request: { method?: string };
	response: {
		end: (chunk?: Uint8Array) => void;
		setHeader: (name: string, value: string) => void;
		statusCode: number;
	};
}): true {
	input.response.statusCode = 404;
	input.response.setHeader("cache-control", "no-store");
	input.response.setHeader("content-type", "text/plain; charset=utf-8");
	input.response.end(
		input.request.method === "HEAD" ? undefined : new TextEncoder().encode("Not Found"),
	);
	return true;
}

function docsDevelopmentAssetContentType(filePath: string): string {
	switch (path.extname(filePath).toLowerCase()) {
		case ".json":
			return "application/json; charset=utf-8";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".png":
			return "image/png";
		case ".svg":
			return "image/svg+xml";
		case ".webp":
			return "image/webp";
		default:
			return "application/octet-stream";
	}
}

function relocateDocsHtmlPages(input: { clientOutputRoot: string; pagesRoot: string }): Plugin {
	const builtPagesRoot = path.resolve(
		input.clientOutputRoot,
		path.relative(__dirname, input.pagesRoot),
	);
	const destinationRoot = path.resolve(input.clientOutputRoot, "docs");
	return {
		applyToEnvironment(environment) {
			return environment.name === "client";
		},
		closeBundle() {
			if (!fs.existsSync(builtPagesRoot)) {
				throw new Error(`generated docs HTML is missing from the Vite output: ${builtPagesRoot}`);
			}
			fs.rmSync(destinationRoot, { force: true, recursive: true });
			fs.mkdirSync(path.dirname(destinationRoot), { recursive: true });
			fs.renameSync(builtPagesRoot, destinationRoot);
			fs.rmSync(path.resolve(input.clientOutputRoot, ".generated"), {
				force: true,
				recursive: true,
			});
		},
		name: "campus-web:relocate-docs-html",
	};
}

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
