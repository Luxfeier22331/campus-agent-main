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
	Bus,
	ClipboardList,
	History,
	KeyRound,
	ListChecks,
	ServerCog,
	UserRoundCheck,
	UsersRound,
	Utensils,
} from "lucide-react";
import { useMemo } from "react";
import type { OpsOverviewWindow } from "../shared/ops-contract";
import { AccountEventsPage } from "./account-events-page";
import { ChatConversationPage } from "./chat-conversation-page";
import { ChatFeedbackPage } from "./chat-feedback-page";
import { ConversationsPage } from "./conversations-page";
import { DiningMenuPage } from "./dining-menu-page";
import { DiningPage } from "./dining-page";
import { DiningReportsPage } from "./dining-reports-page";
import { DiningReviewsPage } from "./dining-reviews-page";
import { DiningSubmissionDetailPage, DiningSubmissionsPage } from "./dining-submissions-page";
import { EmailAccessPage } from "./email-access-page";
import { GroupsPage } from "./groups-page";
import { InternalPortalPage } from "./internal-portal-page";
import { NotFoundPage } from "./not-found-page";
import { NoticesPage } from "./notices-page";
import { OcrPage } from "./ocr-page";
import {
	ignoredRequestSearchParamNames,
	optionalBoundedSearchString,
	optionalRequestListView,
	optionalRequestWindow,
	optionalSearchString,
	optionalStatus,
	optionalTimeWindow,
} from "./ops-view-helpers";
import { OverviewPage } from "./overview-page";
import { ProviderConfigPage } from "./provider-config-page";
import { RequestDetailPage } from "./request-detail-page";
import { RequestsPage as RequestsPageView } from "./requests-page";
import { TransportPage } from "./transport-page";
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
			cursor: optionalBoundedSearchString(search.cursor, 512),
			q: optionalBoundedSearchString(search.q, 256),
			requestId: optionalBoundedSearchString(search.requestId, 128),
			status: optionalStatus(search.status),
			view,
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

const conversationsListRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/conversations",
	validateSearch: (search: Record<string, unknown>) => ({
		q: optionalBoundedSearchString(search.q, 256),
		cursor: optionalBoundedSearchString(search.cursor, 512),
		from: optionalSearchString(search.from),
		to: optionalSearchString(search.to),
		window: optionalTimeWindow(search.window),
		status: optionalStatus(search.status),
		feedback:
			search.feedback === "WITH_FEEDBACK" || search.feedback === "WITHOUT_FEEDBACK"
				? search.feedback
				: undefined,
		hasFailures:
			search.hasFailures === true || search.hasFailures === "true"
				? true
				: search.hasFailures === false || search.hasFailures === "false"
					? false
					: undefined,
	}),
	component: () => <ConversationsPage search={conversationsListRoute.useSearch()} />,
});

const requestDetailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/requests/$requestId",
	validateSearch: (search: Record<string, unknown>) => ({
		from: optionalSearchString(search.from),
	}),
	component: RequestDetailRoute,
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

const internalPortalRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/internal-portal",
	component: InternalPortalPage,
});

const noticesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/notices",
	component: NoticesPage,
});
const ocrRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/ocr",
	component: OcrPage,
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

const diningSubmissionsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/dining/submissions",
	component: DiningSubmissionsPage,
});

const diningSubmissionDetailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/dining/submissions/$submissionId",
	component: () => (
		<DiningSubmissionDetailPage
			submissionId={diningSubmissionDetailRoute.useParams().submissionId}
		/>
	),
});

const diningReviewsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/dining/reviews",
	validateSearch: (search: Record<string, unknown>) => ({
		submission_id: optionalBoundedSearchString(search.submission_id, 200),
	}),
	component: () => (
		<DiningReviewsPage
			key={diningReviewsRoute.useSearch().submission_id}
			initialSubmissionId={diningReviewsRoute.useSearch().submission_id}
		/>
	),
});

const diningReportsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/dining/reports",
	component: DiningReportsPage,
});

const transportRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/transport",
	validateSearch: (search: Record<string, unknown>) => ({
		scheduleId: optionalBoundedSearchString(search.scheduleId, 200),
		kind:
			search.kind === "commute" || search.kind === "subway" || search.kind === "special"
				? search.kind
				: undefined,
	}),
	component: () => (
		<TransportPage
			initialScheduleId={transportRoute.useSearch().scheduleId}
			requestedKind={transportRoute.useSearch().kind}
		/>
	),
});

const chatConversationRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/conversations/$conversationId",
	validateSearch: (search: Record<string, unknown>) => ({
		messageId: optionalBoundedSearchString(search.messageId, 200),
		from: optionalSearchString(search.from),
	}),
	component: ChatConversationRoute,
});

const chatFeedbackRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/chat-feedback",
	validateSearch: (search: Record<string, unknown>) => ({
		feedbackId: optionalBoundedSearchString(search.feedbackId, 200),
		vote: optionalBoundedSearchString(search.vote, 20),
		startDate: optionalBoundedSearchString(search.startDate, 10),
		endDate: optionalBoundedSearchString(search.endDate, 10),
		requestId: optionalBoundedSearchString(search.requestId, 200),
		cursor: optionalBoundedSearchString(search.cursor, 1024),
		history: optionalSearchString(search.history),
	}),
	component: () => <ChatFeedbackPage search={chatFeedbackRoute.useSearch()} />,
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
	conversationsListRoute,
	chatFeedbackRoute,
	chatConversationRoute,
	requestDetailRoute,
	providerConfigRoute,
	internalPortalRoute,
	noticesRoute,
	ocrRoute,
	emailAccessRoute,
	usersRoute,
	accountEventsRoute,
	userDetailRoute,
	diningRoute,
	diningMenuRoute,
	diningSubmissionsRoute,
	diningSubmissionDetailRoute,
	diningReviewsRoute,
	diningReportsRoute,
	transportRoute,
	groupsRoute,
]);

function createOpsRouter(initialPath?: string) {
	return createRouter({
		context: {},
		defaultPreload: "intent",
		...(initialPath ? { history: createMemoryHistory({ initialEntries: [initialPath] }) } : {}),
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
			navGroups={[
				{
					label: "观测",
					items: [
						{ href: "/overview", icon: Activity, label: "运行概览" },
						{ href: "/conversations", icon: History, label: "历史会话" },
						{ href: "/requests", icon: ClipboardList, label: "运行诊断" },
						{ href: "/chat-feedback", icon: ClipboardList, label: "回答反馈" },
					],
				},
				{
					label: "内容维护",
					items: [
						{ href: "/notices", icon: ListChecks, label: "通知维护" },
						{ href: "/ocr", icon: ListChecks, label: "文档识别" },
					],
				},
				{
					label: "账号与权限",
					items: [
						{ href: "/email-access", icon: UserRoundCheck, label: "账号准入" },
						{ href: "/users", icon: UsersRound, label: "用户管理" },
						{ href: "/users/activity", icon: History, label: "账号操作记录" },
					],
				},
				{
					label: "运营配置",
					items: [
						{ href: "/providers", icon: ServerCog, label: "模型配置" },
						{ href: "/internal-portal", icon: KeyRound, label: "内部门户凭据" },
						{ href: "/dining", icon: Utensils, label: "食堂" },
						{ href: "/transport", icon: Bus, label: "班车" },
						{ href: "/groups", icon: UsersRound, label: "同好群" },
					],
				},
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

function DiningRoute() {
	return <DiningPage />;
}

function optionalOverviewWindow(value: unknown): OpsOverviewWindow | undefined {
	return value === "15m" || value === "1h" || value === "6h" || value === "24h" ? value : undefined;
}

function ChatConversationRoute() {
	const { conversationId } = chatConversationRoute.useParams();
	const { messageId, from } = chatConversationRoute.useSearch();
	return (
		<ChatConversationPage
			key={conversationId}
			conversationId={conversationId}
			messageId={messageId}
			from={from}
		/>
	);
}
