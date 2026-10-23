import { Button, Skeleton } from "@campus-agent/ui";
import {
	createRootRouteWithContext,
	createRoute,
	createRouter,
	notFound,
	Outlet,
	type RouterHistory,
	RouterProvider,
	redirect,
	useLocation,
	useMatches,
	useRouter,
	useRouterState,
} from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { buildDocsOutline } from "@/components/docs/docs-reader-view";
import type { DocsSearchRuntime } from "@/components/docs/docs-search-dialog";
import { DocsShell } from "@/components/docs/docs-shell";
import type { DocsDataSource } from "@/features/docs/data-source";
import {
	createBrowserDocsDataSource,
	type DocsDirectoryRouteData,
	type DocsDocumentRouteData,
	type DocsRouteData,
	DocsRouteNotFoundError,
	documentPath,
} from "@/features/docs/data-source";
import { resolveDocsRedirect } from "@/features/docs/docs-redirects";
import { DocsPage } from "./routes/docs-page";

interface DocsRouterContext {
	docsDataSource: DocsDataSource;
	docsSearchRuntime: DocsSearchRuntime | undefined;
	renderMetadata: boolean;
}

const rootRoute = createRootRouteWithContext<DocsRouterContext>()({
	component: RootLayout,
	errorComponent: DocsUnavailablePage,
	notFoundComponent: DocsNotFoundPage,
});

const docsLayoutRoute = createRoute({
	component: DocsRootLayout,
	getParentRoute: () => rootRoute,
	loader: ({ context }) => context.docsDataSource.loadDirectory(),
	path: "/docs",
});

const docsIndexRoute = createRoute({
	component: DocsIndexPage,
	getParentRoute: () => docsLayoutRoute,
	loader: ({ context }) => context.docsDataSource.loadDirectory(),
	path: "/",
});

const docsDocumentRoute = createRoute({
	component: DocsDocumentPage,
	getParentRoute: () => docsLayoutRoute,
	loader: ({ context, params }) =>
		loadDocumentRouteWithRedirect(context.docsDataSource, {
			collection: params.collection,
			corpus: params.corpus,
			routeSlug: params.routeSlug,
		}),
	notFoundComponent: DocsNotFoundPage,
	path: "$corpus/$collection/$routeSlug",
});

const docsDocumentVersionRoute = createRoute({
	component: DocsDocumentVersionPage,
	getParentRoute: () => docsLayoutRoute,
	loader: ({ context, params }) =>
		loadDocumentRouteWithRedirect(context.docsDataSource, {
			collection: params.collection,
			corpus: params.corpus,
			routeSlug: params.routeSlug,
			versionSlug: params.versionSlug,
		}),
	notFoundComponent: DocsNotFoundPage,
	path: "$corpus/$collection/$routeSlug/v/$versionSlug",
});

const docsNotFoundRoute = createRoute({
	component: DocsNotFoundPage,
	getParentRoute: () => docsLayoutRoute,
	loader: () => {
		throw notFound();
	},
	path: "$",
});

const routeTree = rootRoute.addChildren([
	docsLayoutRoute.addChildren([
		docsIndexRoute,
		docsDocumentRoute,
		docsDocumentVersionRoute,
		docsNotFoundRoute,
	]),
]);

export function createDocsRouter(
	input: {
		docsDataSource?: DocsDataSource;
		docsSearchRuntime?: DocsSearchRuntime;
		history?: RouterHistory;
		renderMetadata?: boolean;
	} = {},
) {
	return createRouter({
		context: {
			docsDataSource: input.docsDataSource ?? createBrowserDocsDataSource(),
			docsSearchRuntime: input.docsSearchRuntime,
			renderMetadata: input.renderMetadata ?? true,
		},
		defaultErrorComponent: DocsUnavailablePage,
		defaultNotFoundComponent: DocsNotFoundPage,
		defaultPendingComponent: DocsRoutePending,
		defaultPendingMinMs: 200,
		defaultPendingMs: 100,
		defaultPreload: "intent",
		scrollRestoration: typeof document !== "undefined",
		// The reader owns anchor scrolling. The docs root scrolls smoothly for in-page anchors, so
		// route changes and restores jump explicitly.
		defaultHashScrollIntoView: false,
		scrollRestorationBehavior: "instant",
		...(input.history ? { history: input.history } : {}),
		routeTree,
	});
}

export function DocsRouterProvider({ router }: { router: ReturnType<typeof createDocsRouter> }) {
	return <RouterProvider router={router} />;
}

function DocsIndexPage() {
	const data = docsIndexRoute.useLoaderData() as DocsDirectoryRouteData;
	const { renderMetadata } = docsLayoutRoute.useRouteContext();
	return <DocsPage data={data} renderMetadata={renderMetadata} />;
}

function DocsDocumentPage() {
	const data = docsDocumentRoute.useLoaderData() as DocsDocumentRouteData;
	const { renderMetadata } = docsLayoutRoute.useRouteContext();
	return <DocsPage data={data} renderMetadata={renderMetadata} />;
}

function DocsDocumentVersionPage() {
	const data = docsDocumentVersionRoute.useLoaderData() as DocsDocumentRouteData;
	const { renderMetadata } = docsLayoutRoute.useRouteContext();
	return <DocsPage data={data} renderMetadata={renderMetadata} />;
}

function RootLayout() {
	return <Outlet />;
}

function DocsRootLayout() {
	const layoutData = docsLayoutRoute.useLoaderData() as DocsDirectoryRouteData;
	const location = useLocation();
	const isPending = useRouterState({ select: (state) => state.status === "pending" });
	const leafState = useMatches({
		select: (matches): DocsRouteData | "pending" | null => {
			const leaf = matches.at(-1);
			if (leaf?.status === "pending") {
				return "pending";
			}
			return leaf?.status === "success" && isDocsRouteData(leaf.loaderData)
				? leaf.loaderData
				: null;
		},
	});
	const settledDataRef = useRef<DocsRouteData>(
		leafState === "pending" ? layoutData : (leafState ?? layoutData),
	);
	if (leafState !== "pending") {
		settledDataRef.current = leafState ?? layoutData;
	}
	const shellData = leafState === "pending" ? settledDataRef.current : (leafState ?? layoutData);
	const outline = buildDocsOutline(shellData.kind === "document" ? shellData.reader : null);
	const { docsSearchRuntime } = docsLayoutRoute.useRouteContext();
	useDocsRouteFocus(location.pathname, isPending);

	return (
		<DocsShell
			activePath={location.pathname.replace(/\/$/u, "") || "/"}
			outline={outline}
			searchRuntime={docsSearchRuntime}
			siteIndex={layoutData.siteIndex}
		>
			<Outlet />
		</DocsShell>
	);
}

export function DocsRoutePending() {
	return (
		<section
			aria-busy="true"
			aria-label="正在加载文档"
			className="mx-auto min-h-[60dvh] max-w-3xl px-6 py-12"
			role="status"
		>
			<span className="sr-only">正在加载文档</span>
			<div aria-hidden="true" className="space-y-4">
				<Skeleton className="h-8 w-36 motion-reduce:animate-none" />
				<Skeleton className="h-4 w-full motion-reduce:animate-none" />
				<Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
			</div>
		</section>
	);
}

export function DocsNotFoundPage() {
	return (
		<section className="mx-auto flex min-h-[70dvh] max-w-3xl flex-col justify-center px-6 py-20">
			<p className="text-sm font-medium text-muted-foreground">404</p>
			<h1
				className="mt-3 text-3xl font-semibold tracking-normal text-[var(--sys-text-strong)]"
				tabIndex={-1}
			>
				文档不存在
			</h1>
			<p className="mt-3 text-[var(--sys-text-muted)]">这个文档地址不存在或已经停止发布。</p>
			<Button asChild className="mt-8 w-fit">
				<a href="/docs">返回文档目录</a>
			</Button>
		</section>
	);
}

export function DocsUnavailablePage({ reset }: { reset: () => void }) {
	const router = useRouter();
	const [retrying, setRetrying] = useState(false);

	async function retryRoute() {
		setRetrying(true);
		try {
			await router.invalidate();
			reset();
		} catch {
			// The route remains on the same error page; the user can retry again.
		} finally {
			setRetrying(false);
		}
	}

	return (
		<section className="mx-auto flex min-h-[70dvh] max-w-3xl flex-col justify-center px-6 py-20">
			<h1 className="text-2xl font-semibold text-[var(--sys-text-strong)]" tabIndex={-1}>
				文档暂时无法加载
			</h1>
			<p className="mt-3 text-[var(--sys-text-muted)]">请检查网络连接后重试。</p>
			<Button
				aria-busy={retrying || undefined}
				className="mt-8 w-fit"
				disabled={retrying}
				onClick={() => void retryRoute()}
				type="button"
			>
				{retrying ? "正在重试" : "重试"}
			</Button>
		</section>
	);
}

async function loadDocumentRoute<T>(load: () => Promise<T>): Promise<T> {
	try {
		return await load();
	} catch (error) {
		if (error instanceof DocsRouteNotFoundError) {
			throw notFound();
		}
		throw error;
	}
}

async function loadDocumentRouteWithRedirect(
	dataSource: DocsDataSource,
	target: Parameters<DocsDataSource["loadDocument"]>[0],
): Promise<DocsRouteData> {
	const directory = await dataSource.loadDirectory();
	const redirectPath = resolveDocsRedirect(documentPath(target), directory.siteIndex.redirects);
	if (redirectPath) {
		throw redirect({ replace: true, statusCode: 308, throw: true, to: redirectPath as never });
	}
	return loadDocumentRoute(() => dataSource.loadDocument(target));
}

function isDocsRouteData(value: unknown): value is DocsRouteData {
	return Boolean(
		value &&
			typeof value === "object" &&
			"kind" in value &&
			(value.kind === "directory" || value.kind === "document"),
	);
}

function useDocsRouteFocus(pathname: string, isPending: boolean): void {
	const firstRender = useRef(true);
	const pendingPath = useRef<string | null>(null);
	const previousPath = useRef(pathname);
	useEffect(() => {
		const pathChanged = previousPath.current !== pathname;
		previousPath.current = pathname;
		if (firstRender.current) {
			firstRender.current = false;
			return;
		}
		if (isPending) {
			if (pathChanged) {
				pendingPath.current = pathname;
			}
			return;
		}
		if (!(pathChanged || pendingPath.current === pathname)) {
			return;
		}
		pendingPath.current = null;
		const frame = requestAnimationFrame(() => {
			document.querySelector<HTMLElement>(".docs-main h1")?.focus({ preventScroll: true });
		});
		return () => cancelAnimationFrame(frame);
	}, [isPending, pathname]);
}
