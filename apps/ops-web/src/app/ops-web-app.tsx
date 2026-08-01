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
	AccountAdminAccessStateSchema,
	AccountAdminActionSchema,
	AccountAdminEventWindowSchema,
	AccountAdminOutcomeSchema,
	AccountAdminStateSchema,
} from "campus-contracts/account-admin";
import {
	Activity,
	ClipboardList,
	History,
	ServerCog,
	UserRoundCheck,
	UserRoundX,
	UsersRound,
	Utensils,
} from "lucide-react";
import { useMemo } from "react";
import type { OpsOverviewWindow } from "../shared/ops-contract";
import { AccountDeletionsPage } from "./account-deletions-page";
import { AccountEventsPage } from "./account-events-page";
import { DiningMenuPage } from "./dining-menu-page";
import { DiningPage } from "./dining-page";
import { DiningReportsPage } from "./dining-reports-page";
import { DiningReviewsPage } from "./dining-reviews-page";
import { EmailAccessPage } from "./email-access-page";
import { GroupsPage } from "./groups-page";
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
import { ProviderConfigPage } from "./provider-config-page";
import { RequestDetailPage } from "./request-detail-page";
import { RequestSystemPage } from "./request-system-page";
import { RequestsPage as RequestsPageView } from "./requests-page";
import { SidebarLayout } from "./ui/sidebar-layout";
import { UserDetailPage } from "./user-detail-page";
import { UsersPage } from "./users-page";

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
	component: ProviderConfigRoute,
});

const emailAccessRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/email-access",
	component: EmailAccessPage,
});

const usersRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/users",
	validateSearch: (search: Record<string, unknown>) => ({
		access: AccountAdminAccessStateSchema.safeParse(search.access).data,
		cursor: optionalBoundedSearchString(search.cursor, 512),
		history: optionalBoundedSearchString(search.history, 4096),
		q: optionalBoundedSearchString(search.q, 320),
		state: AccountAdminStateSchema.safeParse(search.state).data,
	}),
	component: UsersRoute,
});

const userDetailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/users/$userId",
	validateSearch: (search: Record<string, unknown>) => ({
		from: optionalBoundedSearchString(search.from, 4096),
	}),
	component: UserDetailRoute,
});

const accountEventsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/users/activity",
	validateSearch: (search: Record<string, unknown>) => ({
		action: AccountAdminActionSchema.safeParse(search.action).data,
		actorId: optionalBoundedSearchString(search.actorId, 200),
		cursor: optionalBoundedSearchString(search.cursor, 512),
		history: optionalBoundedSearchString(search.history, 4096),
		outcome: AccountAdminOutcomeSchema.safeParse(search.outcome).data,
		targetUserId: optionalBoundedSearchString(search.targetUserId, 200),
		window: AccountAdminEventWindowSchema.safeParse(search.window).data ?? "7d",
	}),
	component: AccountEventsRoute,
});

const accountDeletionsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/account-deletions",
	validateSearch: (search: Record<string, unknown>) => ({
		cursor: optionalBoundedSearchString(search.cursor, 512),
		history: optionalBoundedSearchString(search.history, 4096),
		status: optionalDeletionStatus(search.status) ?? "pending",
	}),
	component: AccountDeletionsRoute,
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
	emailAccessRoute,
	usersRoute,
	accountEventsRoute,
	userDetailRoute,
	accountDeletionsRoute,
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
				{ href: "/email-access", icon: UserRoundCheck, label: "账号准入" },
				{ href: "/users", icon: UsersRound, label: "用户管理" },
				{ href: "/users/activity", icon: History, label: "账号操作记录" },
				{ href: "/account-deletions", icon: UserRoundX, label: "账号注销处理" },
				{ href: "/dining", icon: Utensils, label: "食堂" },
				{ href: "/groups", icon: UsersRound, label: "同好群" },
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
	const { from } = requestDetailRoute.useSearch();
	return <RequestDetailPage from={from} requestId={requestId} />;
}

function RequestSystemRoute() {
	const { requestId } = requestSystemRoute.useParams();
	const { from } = requestSystemRoute.useSearch();
	return <RequestSystemPage from={from} requestId={requestId} />;
}

function ProviderConfigRoute() {
	return <ProviderConfigPage />;
}

function UserDetailRoute() {
	return (
		<UserDetailPage
			from={userDetailRoute.useSearch().from}
			userId={userDetailRoute.useParams().userId}
		/>
	);
}

function UsersRoute() {
	return <UsersPage search={usersRoute.useSearch()} />;
}

function AccountEventsRoute() {
	return <AccountEventsPage search={accountEventsRoute.useSearch()} />;
}

function AccountDeletionsRoute() {
	return <AccountDeletionsPage search={accountDeletionsRoute.useSearch()} />;
}

function DiningRoute() {
	return <DiningPage />;
}

function optionalOverviewWindow(value: unknown): OpsOverviewWindow | undefined {
	return value === "15m" || value === "1h" || value === "6h" || value === "24h" ? value : undefined;
}

function optionalDeletionStatus(value: unknown) {
	return value === "pending" || value === "needs_attention" || value === "completed"
		? value
		: value === ""
			? ""
			: undefined;
}
