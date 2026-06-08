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

const releasesRoute = createRoute({
	component: ReleasesPage,
	getParentRoute: () => rootRoute,
	path: "/dining/releases",
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

const routeTree = rootRoute.addChildren([
	indexRoute,
	diningRoute,
	diningFloorRoute,
	releasesRoute,
	auditRoute,
	mapRoute,
	feedbackRoute,
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
