import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { lazy } from "react";
import { NotFoundPage, RootLayout } from "./root-layout";

const AuditPage = lazy(() =>
	import("./routes/audit-page").then((module) => ({ default: module.AuditPage })),
);
const DiningWorkspacePage = lazy(() =>
	import("./routes/dining-workspace-page").then((module) => ({
		default: module.DiningWorkspacePage,
	})),
);
const HomePage = lazy(() =>
	import("./routes/home-page").then((module) => ({ default: module.HomePage })),
);
const ReleasesPage = lazy(() =>
	import("./routes/releases-page").then((module) => ({ default: module.ReleasesPage })),
);
const AssetsPage = lazy(() =>
	import("./routes/placeholder-page").then((module) => ({
		default: () => (
			<module.PlaceholderPage
				description="食堂 SVG 底图随应用发版；区块绑定在楼层工作台维护。"
				title="食堂底图"
			/>
		),
	})),
);
const CandidatesPage = lazy(() =>
	import("./routes/releases-page").then((module) => ({ default: module.ReleasesPage })),
);
const CandidateDetailPage = lazy(() =>
	import("./routes/releases-page").then((module) => ({ default: module.ReleasesPage })),
);
const ReleaseDetailPage = lazy(() =>
	import("./routes/releases-page").then((module) => ({ default: module.ReleasesPage })),
);
const MapPlaceholderPage = lazy(() =>
	import("./routes/placeholder-page").then((module) => ({
		default: () => <module.PlaceholderPage description="空间数据运营入口" title="地图运营" />,
	})),
);
const FeedbackPlaceholderPage = lazy(() =>
	import("./routes/placeholder-page").then((module) => ({
		default: () => <module.PlaceholderPage description="反馈分类与处理队列入口" title="反馈运营" />,
	})),
);
const KnowledgePlaceholderPage = lazy(() =>
	import("./routes/placeholder-page").then((module) => ({
		default: () => <module.PlaceholderPage description="知识源治理与发布入口" title="知识源运营" />,
	})),
);
const NoticesPlaceholderPage = lazy(() =>
	import("./routes/placeholder-page").then((module) => ({
		default: () => <module.PlaceholderPage description="通知源处理与发布入口" title="通知源运营" />,
	})),
);
const ServicesPlaceholderPage = lazy(() =>
	import("./routes/placeholder-page").then((module) => ({
		default: () => (
			<module.PlaceholderPage description="校园服务结构化投影入口" title="校园服务运营" />
		),
	})),
);

const rootRoute = createRootRoute({
	component: RootLayout,
	notFoundComponent: NotFoundPage,
});

const indexRoute = createRoute({
	component: HomePage,
	getParentRoute: () => rootRoute,
	path: "/",
});

const diningRoute = createRoute({
	component: DiningWorkspacePage,
	getParentRoute: () => rootRoute,
	path: "/dining",
});

const diningFloorRoute = createRoute({
	component: DiningWorkspacePage,
	getParentRoute: () => rootRoute,
	path: "/dining/$hallId/$floorId",
});

const diningAssetsRoute = createRoute({
	component: AssetsPage,
	getParentRoute: () => rootRoute,
	path: "/dining/assets",
});

const diningCandidatesRoute = createRoute({
	component: CandidatesPage,
	getParentRoute: () => rootRoute,
	path: "/dining/candidates",
});

const diningCandidateDetailRoute = createRoute({
	component: CandidateDetailPage,
	getParentRoute: () => rootRoute,
	path: "/dining/candidates/$candidateId",
});

const releasesRoute = createRoute({
	component: ReleasesPage,
	getParentRoute: () => rootRoute,
	path: "/dining/releases",
});

const releaseDetailRoute = createRoute({
	component: ReleaseDetailPage,
	getParentRoute: () => rootRoute,
	path: "/dining/releases/$releaseId",
});

const auditRoute = createRoute({
	component: AuditPage,
	getParentRoute: () => rootRoute,
	path: "/dining/audit",
});

const mapRoute = createRoute({
	component: MapPlaceholderPage,
	getParentRoute: () => rootRoute,
	path: "/map",
});

const feedbackRoute = createRoute({
	component: FeedbackPlaceholderPage,
	getParentRoute: () => rootRoute,
	path: "/feedback",
});

const knowledgeRoute = createRoute({
	component: KnowledgePlaceholderPage,
	getParentRoute: () => rootRoute,
	path: "/knowledge",
});

const noticesRoute = createRoute({
	component: NoticesPlaceholderPage,
	getParentRoute: () => rootRoute,
	path: "/notices",
});

const servicesRoute = createRoute({
	component: ServicesPlaceholderPage,
	getParentRoute: () => rootRoute,
	path: "/services",
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	diningRoute,
	diningFloorRoute,
	diningAssetsRoute,
	diningCandidatesRoute,
	diningCandidateDetailRoute,
	releasesRoute,
	releaseDetailRoute,
	auditRoute,
	mapRoute,
	feedbackRoute,
	knowledgeRoute,
	noticesRoute,
	servicesRoute,
]);

const router = createRouter({
	defaultPreload: "intent",
	routeTree,
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

export function AppRouter() {
	return <RouterProvider router={router} />;
}
