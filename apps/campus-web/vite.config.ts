import { spawnSync } from "node:child_process";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { resolveStagingSentryRelease } from "../../scripts/deploy/staging-release.mts";
import { campusBundleGraphPlugin } from "./config/bundle-graph.ts";
import { loadCampusWebBuildEnvironment } from "./scripts/build-process-env.ts";
import { resolveDocsContentPaths } from "./src/docs-reader-build/docs-content.ts";
import {
	type CampusMapAssetKind,
	getCampusMapAssetHeaders,
	getCampusMapAssetKind,
	getRawRequestPathname,
} from "./src/platform/campus-map-assets.ts";

const campusWebRoot = import.meta.dirname;
const repoRoot = path.resolve(campusWebRoot, "../..");
const require = createRequire(import.meta.url);
const campusFaviconPath = path.resolve(campusWebRoot, "assets/favicon.ico");

export default defineConfig(({ command, isPreview }) => {
	const buildTarget = resolveCampusWebBuildTarget();
	const sentryUpload = buildTarget === "app" ? resolveSentrySourceMapUpload() : null;
	if (buildTarget === "docs" && command !== "build") {
		throw new Error("The Campus Web docs build requires static docs content.");
	}
	const docsContent = isPreview ? undefined : resolveDocsBuildContent(command);
	const developmentPort =
		command === "serve" && !isPreview ? resolveCampusWebDevelopmentPort() : undefined;
	const clientOutputRoot = path.resolve(
		campusWebRoot,
		buildTarget === "docs" ? "dist/docs-client" : "dist/client",
	);
	let htmlInputs: Record<string, string> | undefined;
	let docsBuildPlugin: Plugin | undefined;
	if (buildTarget === "docs") {
		if (!docsContent) {
			throw new Error("The Campus Web docs build requires static docs content.");
		}
		htmlInputs = findHtmlInputs(docsContent.paths.pagesRoot);
		docsBuildPlugin = relocateDocsHtmlPages({
			clientOutputRoot,
			pagesRoot: docsContent.paths.pagesRoot,
		});
	}
	return {
		build: {
			sourcemap: sentryUpload ? ("hidden" as const) : false,
			...(buildTarget === "app"
				? { rollupOptions: { input: path.resolve(campusWebRoot, "index.html") } }
				: {}),
			...(buildTarget === "docs" ? { emptyOutDir: true, outDir: clientOutputRoot } : {}),
		},
		environments: {
			client: {
				build: {
					...(htmlInputs ? { rollupOptions: { input: htmlInputs } } : {}),
				},
			},
		},
		publicDir: docsContent?.paths.publicRoot ?? (false as const),
		plugins: [
			tailwindcss(),
			react(),
			campusBundleGraphPlugin({
				entry: buildTarget,
				outputFile: path.resolve(
					campusWebRoot,
					buildTarget === "docs"
						? ".generated/docs-bundle-graph.json"
						: ".generated/bundle-graph.json",
				),
			}),
			...(docsBuildPlugin
				? [docsBuildPlugin]
				: [
						...(command === "serve" ? [serveStyleDevelopmentShell()] : []),
						copyCampusFavicon(),
						copyMapLibreVendor(),
						copyCampusMapAssets(),
						cloudflare({ inspectorPort: false }),
					]),
			...(buildTarget === "app" && command === "serve" && docsContent
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
				"@": path.resolve(campusWebRoot, "src"),
			},
			dedupe: ["react", "react-dom"],
		},
		...(developmentPort
			? {
					server: {
						host: "127.0.0.1",
						port: developmentPort,
						strictPort: true,
					},
				}
			: {}),
	};
});

function serveStyleDevelopmentShell(): Plugin {
	const shellPath = path.resolve(campusWebRoot, "style-dev.html");
	return {
		enforce: "pre",
		configureServer(server) {
			const styleDevMiddleware = async (
				request: IncomingMessage,
				response: ServerResponse,
				next: (error?: unknown) => void,
			) => {
				const url = new URL(request.url ?? "/", "http://campus.local");
				const acceptHeader = request.headers.accept;
				const acceptsHtml = (
					Array.isArray(acceptHeader) ? acceptHeader.join(",") : (acceptHeader ?? "")
				).match(/(?:text\/html|\*\/\*)/u);
				if (
					(request.method !== "GET" && request.method !== "HEAD") ||
					url.pathname !== "/style-dev.html" ||
					!acceptsHtml
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
			};
			server.middlewares.use(styleDevMiddleware);
			return () => moveMiddlewareToFront(server.middlewares, styleDevMiddleware);
		},
		name: "campus-web:style-development-shell",
	};
}

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

function resolveDocsBuildContent(command: "build" | "serve"): {
	paths: ReturnType<typeof resolveDocsContentPaths>;
} {
	let configuredRoot = process.env.CAMPUS_WEB_DOCS_CONTENT_ROOT?.trim();
	if (!configuredRoot && command === "serve") {
		configuredRoot = prepareDocsDevelopmentContent();
	}
	if (!configuredRoot) {
		throw new Error(
			"Campus Web requires prepared docs content. Use pnpm run dev or pnpm run build.",
		);
	}
	return { paths: resolveDocsContentPaths(configuredRoot) };
}

function prepareDocsDevelopmentContent(): string {
	const result = spawnSync(
		process.platform === "win32" ? "pnpm.cmd" : "pnpm",
		["exec", "tsx", "./scripts/prepare-docs-content.ts"],
		{
			cwd: campusWebRoot,
			encoding: "utf8",
			env: loadCampusWebBuildEnvironment({ appRoot: campusWebRoot, repoRoot }),
			stdio: "pipe",
		},
	);
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		if (result.stderr) {
			process.stderr.write(result.stderr);
		}
		throw new Error(
			`Campus Web docs preparation exited with status ${result.status ?? "unknown"}.`,
		);
	}
	try {
		const parsed = JSON.parse(result.stdout.trim()) as { root?: unknown };
		if (typeof parsed.root !== "string" || !parsed.root) {
			throw new Error("missing root");
		}
		return parsed.root;
	} catch {
		throw new Error("Campus Web docs preparation returned invalid output.");
	}
}

function resolveCampusWebDevelopmentPort(): number {
	const rawPort = loadCampusWebBuildEnvironment({
		appRoot: campusWebRoot,
		repoRoot,
	}).CAMPUS_WEB_DEV_PORT?.trim();
	const port = Number(rawPort);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error("CAMPUS_WEB_DEV_PORT must be a valid TCP port.");
	}
	return port;
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
	const shellPath = path.resolve(campusWebRoot, "docs-dev.html");
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
	request: { method?: string | undefined };
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
	request: { method?: string | undefined };
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
		path.relative(campusWebRoot, input.pagesRoot),
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

function copyCampusFavicon(): Plugin {
	return {
		closeBundle() {
			const targetPath = path.resolve(campusWebRoot, "dist/client/favicon.ico");
			fs.mkdirSync(path.dirname(targetPath), { recursive: true });
			fs.copyFileSync(campusFaviconPath, targetPath);
		},
		configureServer(server) {
			server.middlewares.use("/favicon.ico", (_request, response, next) => {
				response.setHeader("content-type", "image/x-icon");
				fs.createReadStream(campusFaviconPath).on("error", next).pipe(response);
			});
		},
		name: "campus-web:copy-favicon",
	};
}

function copyMapLibreVendor(): Plugin {
	const vendorFiles = new Map([
		["maplibre-gl.mjs", "text/javascript; charset=utf-8"],
		["maplibre-gl-worker.mjs", "text/javascript; charset=utf-8"],
		["maplibre-gl.css", "text/css; charset=utf-8"],
		["LICENSE.txt", "text/plain; charset=utf-8"],
	]);
	const runtimeShimFileName = "maplibre-gl-runtime.mjs";
	const runtimeShim =
		'import * as maplibregl from "./maplibre-gl.mjs";\nwindow.maplibregl = maplibregl;\n';

	function getVendorSourcePath(fileName: string) {
		const packageJsonPath = require.resolve("maplibre-gl/package.json");
		const packageRoot = path.dirname(packageJsonPath);
		return path.join(
			fileName === "LICENSE.txt" ? packageRoot : path.join(packageRoot, "dist"),
			fileName,
		);
	}

	return {
		closeBundle() {
			const targetDir = path.resolve(campusWebRoot, "dist/client/vendor/maplibre-gl");
			fs.mkdirSync(targetDir, { recursive: true });
			for (const fileName of vendorFiles.keys()) {
				fs.copyFileSync(getVendorSourcePath(fileName), path.join(targetDir, fileName));
			}
			fs.writeFileSync(path.join(targetDir, runtimeShimFileName), runtimeShim);
		},
		configureServer(server) {
			server.middlewares.use("/vendor/maplibre-gl", (request, response, next) => {
				const fileName = path.basename(request.url?.split("?")[0] ?? "");
				if (fileName === runtimeShimFileName) {
					response.setHeader("content-type", "text/javascript; charset=utf-8");
					response.end(runtimeShim);
					return;
				}
				const contentType = vendorFiles.get(fileName);
				if (!contentType) {
					next();
					return;
				}

				const filePath = getVendorSourcePath(fileName);
				response.setHeader("content-type", contentType);
				fs.createReadStream(filePath).on("error", next).pipe(response);
			});
		},
		name: "campus-web:copy-maplibre-vendor",
	};
}

function copyCampusMapAssets(): Plugin {
	const sourceRoot = path.resolve(campusWebRoot, "assets/campus-map");
	return {
		closeBundle() {
			const targetRoot = path.resolve(campusWebRoot, "dist/client/campus-map");
			if (!fs.existsSync(sourceRoot)) {
				throw new Error(`Campus map assets are missing: ${sourceRoot}`);
			}
			const manifestSource = path.join(sourceRoot, "manifest.json");
			if (!isRegularFile(manifestSource)) {
				throw new Error(`Campus map manifest is missing: ${manifestSource}`);
			}
			fs.rmSync(targetRoot, { force: true, recursive: true });
			fs.mkdirSync(targetRoot, { recursive: true });
			fs.copyFileSync(manifestSource, path.join(targetRoot, "manifest.json"));
			copyCampusMapDigestAssets({
				expectedKind: "geojson",
				sourceDirectory: path.join(sourceRoot, "assets"),
				targetDirectory: path.join(targetRoot, "assets"),
			});
			copyCampusMapDigestAssets({
				expectedKind: "places",
				sourceDirectory: path.join(sourceRoot, "places"),
				targetDirectory: path.join(targetRoot, "places"),
			});
		},
		configureServer(server) {
			server.middlewares.use("/campus-map", (request, response, next) => {
				serveCampusMapDevelopmentAsset({
					next,
					request,
					response,
					sourceRoot,
				});
			});
			moveLatestConnectMiddlewareToFront(server.middlewares);
		},
		enforce: "pre",
		name: "campus-web:copy-campus-map-assets",
	};
}

function moveLatestConnectMiddlewareToFront(middlewares: { stack?: unknown[] }): void {
	const stack = middlewares.stack;
	const layer = stack?.pop();
	if (layer) {
		stack?.unshift(layer);
	}
}

function moveMiddlewareToFront(middlewares: { stack?: unknown[] }, handler: unknown): void {
	const stack = middlewares.stack;
	if (!stack) {
		return;
	}
	const index = stack.findIndex(
		(layer) =>
			typeof layer === "object" &&
			layer !== null &&
			"handle" in layer &&
			(layer as { handle?: unknown }).handle === handler,
	);
	if (index <= 0) {
		return;
	}
	const [layer] = stack.splice(index, 1);
	if (layer) {
		stack.unshift(layer);
	}
}

export function serveCampusMapDevelopmentAsset(input: {
	next?: (error?: unknown) => void;
	request: { method?: string | undefined; url?: string | undefined };
	response: {
		end: (chunk?: Uint8Array) => void;
		setHeader: (name: string, value: string) => void;
		statusCode: number;
	};
	sourceRoot: string;
}): boolean {
	if (input.request.method !== "GET" && input.request.method !== "HEAD") {
		return serveCampusMapDevelopmentAssetNotFound(input);
	}

	const pathname = restoreCampusMapPathname(input.request.url);
	const assetKind = getCampusMapAssetKind(pathname);
	if (!assetKind) {
		return serveCampusMapDevelopmentAssetNotFound(input);
	}

	const target = resolveCampusMapAssetSource(input.sourceRoot, pathname, assetKind);
	if (!isRegularFile(target)) {
		return serveCampusMapDevelopmentAssetNotFound(input);
	}

	const headers = getCampusMapAssetHeaders(assetKind);
	input.response.statusCode = 200;
	for (const [key, value] of Object.entries(headers)) {
		input.response.setHeader(key, value);
	}
	if (input.request.method === "HEAD") {
		input.response.end();
		return true;
	}

	try {
		input.response.end(fs.readFileSync(target));
	} catch (error) {
		if (input.next) {
			input.next(error);
			return true;
		}
		throw error;
	}
	return true;
}

function serveCampusMapDevelopmentAssetNotFound(input: {
	request: { method?: string | undefined };
	response: {
		end: (chunk?: Uint8Array) => void;
		setHeader: (name: string, value: string) => void;
		statusCode: number;
	};
}): true {
	input.response.statusCode = 404;
	input.response.setHeader("cache-control", "no-store");
	input.response.end();
	return true;
}

function restoreCampusMapPathname(relativePath: string | undefined): string {
	const pathname = getRawRequestPathname(relativePath);
	if (pathname === "/campus-map" || pathname.startsWith("/campus-map/")) {
		return pathname;
	}
	return pathname.startsWith("/") ? `/campus-map${pathname}` : `/campus-map/${pathname}`;
}

function resolveCampusMapAssetSource(
	sourceRoot: string,
	pathname: string,
	kind: CampusMapAssetKind,
): string {
	if (kind === "manifest") {
		return path.join(sourceRoot, "manifest.json");
	}
	const prefix = kind === "geojson" ? "/campus-map/assets/" : "/campus-map/places/";
	return path.join(
		sourceRoot,
		kind === "geojson" ? "assets" : "places",
		pathname.slice(prefix.length),
	);
}

function isRegularFile(filePath: string): boolean {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

function copyCampusMapDigestAssets(input: {
	expectedKind: Extract<CampusMapAssetKind, "geojson" | "places">;
	sourceDirectory: string;
	targetDirectory: string;
}): void {
	if (!fs.existsSync(input.sourceDirectory)) {
		return;
	}
	fs.mkdirSync(input.targetDirectory, { recursive: true });
	for (const entry of fs.readdirSync(input.sourceDirectory, { withFileTypes: true })) {
		if (!entry.isFile()) {
			continue;
		}
		const kind = getCampusMapAssetKind(
			`/campus-map/${input.expectedKind === "geojson" ? "assets" : "places"}/${entry.name}`,
		);
		if (kind !== input.expectedKind) {
			continue;
		}
		fs.copyFileSync(
			path.join(input.sourceDirectory, entry.name),
			path.join(input.targetDirectory, entry.name),
		);
	}
}
