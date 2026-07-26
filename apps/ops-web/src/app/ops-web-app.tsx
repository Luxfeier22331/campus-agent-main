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
import {
	Activity,
	ClipboardList,
	Database,
	KeyRound,
	ServerCog,
	UsersRound,
	Utensils,
} from "lucide-react";
import { useMemo } from "react";
import type { OpsOverviewWindow } from "../shared/ops-contract";
import { DiningMenuPage } from "./dining-menu-page";
import { DiningPage } from "./dining-page";
import { DiningReportsPage } from "./dining-reports-page";
import { DiningReviewsPage } from "./dining-reviews-page";
import { GroupsPage } from "./groups-page";
import { IngestionPage } from "./ingestion-page";
import { IngestionTaskPage } from "./ingestion-task-page";
import { InternalPortalAuthPage } from "./internal-portal-auth-page";
import { NotFoundPage } from "./not-found-page";
import {
	ignoredRequestSearchParamNames,
	optionalBoundedSearchString,
	optionalRequestListView,
	optionalRequestWindow,
	optionalSearchString,
	optionalStatus,
} from "./ops-view-helpers";
import { OverviewPage } from "./overview-page";
import { type ModelSettingsService, ProviderConfigPage } from "./provider-config-page";
import { RequestDetailPage } from "./request-detail-page";
import { RequestSystemPage } from "./request-system-page";
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
		const view = optionalRequestListView(search.view);
		const parsed = {
			conversationId: optionalBoundedSearchString(search.conversationId, 128),
			cursor: optionalBoundedSearchString(search.cursor, 512),
			q: optionalBoundedSearchString(search.q, 256),
			requestId: optionalBoundedSearchString(search.requestId, 128),
			runId: optionalBoundedSearchString(search.runId, 128),
			status: optionalStatus(search.status),
			traceId: optionalBoundedSearchString(search.traceId, 128),
			view,
			window: optionalRequestWindow(search.window),
			workflowId: optionalBoundedSearchString(search.workflowId, 128),
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
	}),
	component: RequestDetailRoute,
});

const requestSystemRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/requests/$requestId/system",
	validateSearch: (search: Record<string, unknown>) => ({
		from: optionalSearchString(search.from),
	}),
	component: RequestSystemRoute,
});

const providerConfigRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/providers",
	validateSearch: (search: Record<string, unknown>) => ({
		service: optionalModelSettingsService(search.service) ?? "execution",
	}),
	component: ProviderConfigRoute,
});

const internalPortalAuthRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/internal-portal-auth",
	component: InternalPortalAuthPage,
});

const ingestionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/ingestion",
	component: IngestionPage,
});

const ingestionTaskRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/ingestion/tasks/$taskId",
	component: IngestionTaskRoute,
});

const diningRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/dining",
	component: DiningRoute,
});

const diningMenuRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/dining/menu",
	component: DiningMenuPage,
});

const diningReviewsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/dining/reviews",
	component: DiningReviewsPage,
});

const diningReportsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/dining/reports",
	component: DiningReportsPage,
});

const groupsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/groups",
	component: GroupsPage,
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	overviewRoute,
	requestsRoute,
	requestSystemRoute,
	requestDetailRoute,
	providerConfigRoute,
	internalPortalAuthRoute,
	ingestionRoute,
	ingestionTaskRoute,
	diningRoute,
	diningMenuRoute,
	diningReviewsRoute,
	diningReportsRoute,
	groupsRoute,
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
				{ href: "/requests", icon: ClipboardList, label: "运行记录" },
				{ href: "/providers", icon: ServerCog, label: "模型配置" },
				{ href: "/ingestion", icon: Database, label: "采集运行" },
				{ href: "/internal-portal-auth", icon: KeyRound, label: "门户认证" },
				{ href: "/dining", icon: Utensils, label: "食堂" },
				{ href: "/groups", icon: UsersRound, label: "同好群" },
			]}
		>
			<Outlet />
		</SidebarLayout>
	);
}

function IngestionTaskRoute() {
	return <IngestionTaskPage taskId={ingestionTaskRoute.useParams().taskId} />;
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
	const { from } = requestDetailRoute.useSearch();
	return <RequestDetailPage from={from} requestId={requestId} />;
}

function RequestSystemRoute() {
	const { requestId } = requestSystemRoute.useParams();
	const { from } = requestSystemRoute.useSearch();
	return <RequestSystemPage from={from} requestId={requestId} />;
}

function ProviderConfigRoute() {
	const search = providerConfigRoute.useSearch();
	return <ProviderConfigPage service={search.service} />;
}

function DiningRoute() {
	return <DiningPage />;
}

function optionalOverviewWindow(value: unknown): OpsOverviewWindow | undefined {
	return value === "15m" || value === "1h" || value === "6h" || value === "24h" ? value : undefined;
}

function optionalModelSettingsService(value: unknown): ModelSettingsService | undefined {
	return value === "execution" || value === "hindsight" ? value : undefined;
}
