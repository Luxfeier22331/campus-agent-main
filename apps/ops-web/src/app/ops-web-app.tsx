import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
	redirect,
} from "@tanstack/react-router";
import { Activity, ClipboardList } from "lucide-react";
import { useMemo } from "react";
import type { OpsOverviewWindow } from "../shared/ops-contract";
import { NotFoundPage } from "./not-found-page";
import {
	ignoredRequestSearchParamNames,
	optionalBoundedSearchString,
	optionalLimit,
	optionalRequestWindow,
	optionalSearchString,
	optionalStatus,
} from "./ops-view-helpers";
import { OverviewPage } from "./overview-page";
import { RequestDetailPage, type RequestDetailTab } from "./request-detail-page";
import { RequestsPage as RequestsPageView } from "./requests-page";
import { SidebarLayout } from "./ui/sidebar-layout";

function makeQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				gcTime: 10 * 60_000,
				refetchOnWindowFocus: true,
				retry: false,
				staleTime: 15_000,
			},
		},
	});
}

const rootRoute = createRootRoute({
	component: RootLayout,
	notFoundComponent: NotFoundPage,
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	beforeLoad: () => {
		throw redirect({ to: "/overview" });
	},
});

const overviewRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/overview",
	validateSearch: (search: Record<string, unknown>) => ({
		window: optionalOverviewWindow(search.window) ?? "1h",
	}),
	component: OverviewRoute,
});

const requestsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/requests",
	validateSearch: (search: Record<string, unknown>) => {
		const parsed = {
			conversationId: optionalBoundedSearchString(search.conversationId, 128),
			cursor: optionalBoundedSearchString(search.cursor, 512),
			limit: optionalLimit(search.limit),
			previous: optionalBoundedSearchString(search.previous, 512),
			q: optionalBoundedSearchString(search.q, 256),
			requestId: optionalBoundedSearchString(search.requestId, 128),
			status: optionalStatus(search.status),
			traceId: optionalBoundedSearchString(search.traceId, 128),
			window: optionalRequestWindow(search.window),
		};
		const ignored = ignoredRequestSearchParamNames(search, parsed);
		return {
			...parsed,
			...(ignored.length > 0 ? { ignored: ignored.join(",") } : {}),
		};
	},
	component: RequestsRoute,
});

const requestDetailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/requests/$requestId",
	validateSearch: (search: Record<string, unknown>) => ({
		from: optionalSearchString(search.from),
		tab: optionalRequestDetailTab(search.tab) ?? "overview",
	}),
	component: RequestDetailRoute,
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	overviewRoute,
	requestsRoute,
	requestDetailRoute,
]);

function createOpsRouter(initialPath?: string) {
	return createRouter({
		context: {},
		defaultPreload: "intent",
		history: initialPath ? createMemoryHistory({ initialEntries: [initialPath] }) : undefined,
		routeTree,
	});
}

export function OpsWebApp({ initialPath }: { initialPath?: string }) {
	const queryClient = useMemo(() => makeQueryClient(), []);
	const router = useMemo(() => createOpsRouter(initialPath), [initialPath]);

	return (
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	);
}

function RootLayout() {
	return (
		<SidebarLayout
			navItems={[
				{ href: "/overview", icon: Activity, label: "运行概览" },
				{ href: "/requests", icon: ClipboardList, label: "请求排查" },
			]}
		>
			<Outlet />
		</SidebarLayout>
	);
}

function OverviewRoute() {
	return <OverviewPage window={overviewRoute.useSearch().window} />;
}

function RequestsRoute() {
	const search = requestsRoute.useSearch();
	return (
		<RequestsPageView
			ignoredParams={search.ignored ? search.ignored.split(",").filter(Boolean) : []}
			search={search}
		/>
	);
}

function RequestDetailRoute() {
	const { requestId } = requestDetailRoute.useParams();
	const { from, tab } = requestDetailRoute.useSearch();
	return <RequestDetailPage from={from} requestId={requestId} tab={tab} />;
}

function optionalOverviewWindow(value: unknown): OpsOverviewWindow | undefined {
	return value === "15m" || value === "1h" || value === "6h" || value === "24h" ? value : undefined;
}

function optionalRequestDetailTab(value: unknown): RequestDetailTab | undefined {
	return value === "overview" || value === "execution" || value === "observability"
		? value
		: undefined;
}
