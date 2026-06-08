import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { NotFoundPage, RootLayout } from "./root-layout";
import { AuditPage } from "./routes/audit-page";
import { DiningWorkspacePage } from "./routes/dining-workspace-page";
import { HomePage } from "./routes/home-page";
import { PlaceholderPage } from "./routes/placeholder-page";
import { ReleasesPage } from "./routes/releases-page";

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
	component: () => <PlaceholderPage description="空间数据运营入口" title="地图运营" />,
	getParentRoute: () => rootRoute,
	path: "/map",
});

const feedbackRoute = createRoute({
	component: () => <PlaceholderPage description="反馈分类与处理队列入口" title="反馈运营" />,
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
