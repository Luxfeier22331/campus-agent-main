import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { createMemoryHistory } from "@tanstack/react-router";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";

import { createDocsRouter, DocsRouterProvider } from "../app/docs-router.tsx";
import { composeCampusPageTitle, resolveCampusCanonicalUrl } from "../app/page-metadata.ts";
import { DOCS_ROUTE_BOOTSTRAP_ID, type DocsRouteData } from "../features/docs/data-source.ts";
import { resolveDocsPageMetadata } from "../features/docs/page-metadata.ts";
import { createBuildDocsDataSource } from "./native-reader-data-source.ts";
import { NATIVE_DOCS_CATALOG_FILE, readNativeDocsCatalog } from "./native-reader-site.ts";

const DOCS_NOT_FOUND_ROUTE = "/docs/_not-found";

type NativeDocsPageInput =
	| { appHtml: string; kind: "not_found" }
	| { appHtml: string; kind: "route"; route: string; routeData: DocsRouteData };

export async function writeNativeDocsHtmlPages(input: {
	generatedRoot: string;
	pagesRoot: string;
	publicRoot: string;
}): Promise<{ pageCount: number }> {
	const pagesRoot = resolve(input.pagesRoot);
	rmSync(pagesRoot, { force: true, recursive: true });
	const catalog = readNativeDocsCatalog(resolve(input.generatedRoot, NATIVE_DOCS_CATALOG_FILE));
	const routes = buildPrerenderRoutes(catalog);
	const docsDataSource = createBuildDocsDataSource(input);
	for (const route of routes) {
		const router = createDocsRouter({
			docsDataSource,
			history: createMemoryHistory({ initialEntries: [route] }),
			renderMetadata: false,
		});
		await router.load();
		const routeStatus = router.state.matches.at(-1)?.status;
		if (routeStatus !== "success") {
			throw new Error(`native docs prerender failed for ${route}: ${routeStatus ?? "missing"}`);
		}
		const routeData = router.state.matches.at(-1)?.loaderData as DocsRouteData | undefined;
		if (!routeData) {
			throw new Error(`native docs prerender data is missing: ${route}`);
		}
		const appHtml = renderToString(
			<StrictMode>
				<DocsRouterProvider router={router} />
			</StrictMode>,
		);
		const target = routeTargetPath(pagesRoot, route);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, buildHtmlDocument({ appHtml, kind: "route", route, routeData }), "utf8");
	}

	const notFoundRouter = createDocsRouter({
		docsDataSource,
		history: createMemoryHistory({ initialEntries: [DOCS_NOT_FOUND_ROUTE] }),
		renderMetadata: false,
	});
	await notFoundRouter.load();
	const notFoundMatch = notFoundRouter.state.matches.find((match) => match._notFound);
	if (!notFoundMatch) {
		throw new Error(
			`native docs prerender failed for ${DOCS_NOT_FOUND_ROUTE}: notFound match is missing`,
		);
	}
	const notFoundHtml = renderToString(
		<StrictMode>
			<DocsRouterProvider router={notFoundRouter} />
		</StrictMode>,
	);
	const notFoundTarget = resolve(pagesRoot, "404.html");
	mkdirSync(dirname(notFoundTarget), { recursive: true });
	writeFileSync(
		notFoundTarget,
		buildHtmlDocument({ appHtml: notFoundHtml, kind: "not_found" }),
		"utf8",
	);
	writeStaticAssetControls({
		publicRoot: input.publicRoot,
		redirects: catalog.siteIndex.redirects,
	});

	return { pageCount: routes.length + 1 };
}

function writeStaticAssetControls(input: {
	publicRoot: string;
	redirects: Array<{ fromPath: string; statusCode: 308; toPath: string }>;
}): void {
	mkdirSync(input.publicRoot, { recursive: true });
	writeFileSync(resolve(input.publicRoot, "_headers"), buildStaticHeaders(), "utf8");
	writeFileSync(
		resolve(input.publicRoot, "_redirects"),
		`${input.redirects
			.map((redirect) => `${redirect.fromPath} ${redirect.toPath} ${redirect.statusCode}`)
			.join("\n")}${input.redirects.length > 0 ? "\n" : ""}`,
		"utf8",
	);
}

function buildStaticHeaders(): string {
	return `/docs
  Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self'; worker-src 'self' blob:
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff

/docs/*
  Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self'; worker-src 'self' blob:
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff

/_docs/*
  X-Content-Type-Options: nosniff
`;
}

function buildPrerenderRoutes(catalog: ReturnType<typeof readNativeDocsCatalog>): string[] {
	const routes = new Set<string>(["/docs"]);
	for (const route of catalog.routes) {
		routes.add(route.canonicalUrl);
	}
	for (const redirect of catalog.siteIndex.redirects) {
		if (routes.has(redirect.fromPath) || !routes.has(redirect.toPath)) {
			throw new Error(`docs redirect is invalid: ${redirect.fromPath} -> ${redirect.toPath}`);
		}
	}
	return [...routes].sort();
}

function routeTargetPath(pagesRoot: string, route: string): string {
	const url = new URL(route, "https://campus.local");
	if (
		url.origin !== "https://campus.local" ||
		!(url.pathname === "/docs" || url.pathname.startsWith("/docs/"))
	) {
		throw new Error(`native docs prerender route is invalid: ${route}`);
	}
	const relativePath = url.pathname.slice("/docs".length).replace(/^\/+/, "");
	const target = resolve(pagesRoot, relativePath, "index.html");
	if (!(target === pagesRoot || target.startsWith(`${pagesRoot}${sep}`))) {
		throw new Error(`native docs prerender route escapes output root: ${route}`);
	}
	return target;
}

function buildHtmlDocument(input: NativeDocsPageInput): string {
	const routeData = input.kind === "route" ? input.routeData : null;
	const metadata = routeData
		? resolveDocsPageMetadata(routeData)
		: {
				canonicalPath: null,
				description: "这个文档地址不存在或已经停止发布。",
				robots: "noindex,nofollow" as const,
				title: composeCampusPageTitle("文档不存在"),
			};
	const canonicalUrl = resolveCampusCanonicalUrl(metadata.canonicalPath);
	const canonical = canonicalUrl
		? `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" vite-ignore />`
		: "";
	const bootstrap = routeData ? buildRouteBootstrapTemplate(routeData) : "";
	return `<!doctype html>
<html lang="zh-CN">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<meta name="color-scheme" content="light dark" />
		<meta name="description" content="${escapeHtml(metadata.description)}" />
		<meta name="robots" content="${metadata.robots}" />
		<link rel="icon" href="/favicon.ico" type="image/x-icon" />
		<script src="/theme-bootstrap.js"></script>
		<link rel="stylesheet" href="/src/styles.css" />
		<link rel="stylesheet" href="/src/components/docs/docs-reader.css" />
		${canonical}
		<title>${escapeHtml(metadata.title)}</title>
	</head>
	<body>
		<div id="root" data-campus-prerendered="docs">${input.appHtml}</div>
		${bootstrap}
		<script type="module" src="/src/docs-main.tsx"></script>
	</body>
</html>
`;
}

function buildRouteBootstrapTemplate(data: DocsRouteData): string {
	return `<template id="${DOCS_ROUTE_BOOTSTRAP_ID}">${serializeJsonForHtml(data)}</template>`;
}

function serializeJsonForHtml(value: unknown): string {
	return JSON.stringify(value).replace(/&/gu, "&amp;").replace(/</gu, "\\u003c");
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/gu, "&amp;")
		.replace(/</gu, "&lt;")
		.replace(/>/gu, "&gt;")
		.replace(/"/gu, "&quot;")
		.replace(/'/gu, "&#39;");
}
