import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { NotFoundPage, RootLayout } from "./root-layout";
import { ConversationPage } from "./routes/conversation-page";
import { DiningPage } from "./routes/dining-page";
import { DocsPage } from "./routes/docs-page";
import { FeedbackPage } from "./routes/feedback-page";
import { HomePage } from "./routes/home-page";
import { MapPage } from "./routes/map-page";

const rootRoute = createRootRoute({
	component: RootLayout,
	notFoundComponent: NotFoundPage,
});

const indexRoute = createRoute({
	component: HomePage,
	getParentRoute: () => rootRoute,
	path: "/",
});

const conversationRoute = createRoute({
	component: ConversationPage,
	getParentRoute: () => rootRoute,
	path: "/c/$conversationId",
});

const docsRoute = createRoute({
	component: DocsPage,
	getParentRoute: () => rootRoute,
	path: "/docs/$",
});

const mapRoute = createRoute({
	component: MapPage,
	getParentRoute: () => rootRoute,
	path: "/map",
});

const diningRoute = createRoute({
	component: DiningPage,
	getParentRoute: () => rootRoute,
	path: "/dining",
});

const feedbackRoute = createRoute({
	component: FeedbackPage,
	getParentRoute: () => rootRoute,
	path: "/feedback",
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	conversationRoute,
	docsRoute,
	mapRoute,
	diningRoute,
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
