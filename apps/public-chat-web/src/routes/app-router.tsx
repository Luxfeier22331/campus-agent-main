import { buildPublicChatAuthCompatPath } from "@platform/auth/hub-redirect";
import { ChatbotShellRuntimeProvider, useChatbotShellRuntime } from "@platform/chat/runtime";
import {
	createRootRoute,
	createRoute,
	createRouter,
	Navigate,
	Outlet,
	RouterProvider,
	useLocation,
} from "@tanstack/react-router";
import { lazy, Suspense, useEffect } from "react";

const ChatAppShell = lazy(async () => {
	const module = await import("@platform/chat/app-shell");

	return {
		default: module.ChatAppShell,
	};
});

function RootRouteComponent() {
	return <Outlet />;
}

function ChatRouteBootstrapFallback() {
	return (
		<div className="chat-route-fallback bg-sidebar" role="status">
			<div aria-hidden="true" className="chat-boot-fallback__spinner" />
			<span>正在载入校园助理...</span>
		</div>
	);
}

function ChatRouteErrorFallback(props: { onRetry: () => Promise<void> }) {
	return (
		<div className="chat-route-fallback bg-sidebar px-6">
			<section className="w-full max-w-sm rounded-2xl border border-border/50 bg-background p-5 text-center shadow-sm">
				<h1 className="text-base font-semibold text-foreground">服务连接暂时不可用</h1>
				<p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
					我们暂时无法确认你的登录状态。请检查网络后重新连接。
				</p>
				<button
					className="mt-4 inline-flex min-h-10 items-center justify-center rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring/40"
					onClick={() => {
						void props.onRetry();
					}}
					type="button"
				>
					重新连接
				</button>
			</section>
		</div>
	);
}

function AuthenticatedChatRouteGuard() {
	const { refreshSession, session } = useChatbotShellRuntime();
	const location = useLocation();
	const returnTo = `${location.pathname}${location.search}${location.hash}`;

	if (session.kind === "loading") {
		return <ChatRouteBootstrapFallback />;
	}

	if (session.kind === "unauthenticated") {
		return <FullDocumentRedirect href={buildPublicChatAuthCompatPath("login", { returnTo })} />;
	}

	if (session.kind === "error") {
		return <ChatRouteErrorFallback onRetry={refreshSession} />;
	}

	if (!session.principal.canChat) {
		return <FullDocumentRedirect href={buildPublicChatAuthCompatPath("login", { returnTo })} />;
	}

	return <Outlet />;
}

function AuthenticatedChatRoute() {
	return (
		<ChatbotShellRuntimeProvider>
			<AuthenticatedChatRouteGuard />
		</ChatbotShellRuntimeProvider>
	);
}

function ChatRoutePage() {
	return (
		<Suspense fallback={<ChatRouteBootstrapFallback />}>
			<ChatAppShell />
		</Suspense>
	);
}

function FullDocumentRedirect(props: { href: string }) {
	useEffect(() => {
		window.location.replace(props.href);
	}, [props.href]);

	return <ChatRouteBootstrapFallback />;
}

function CompatAuthRoute() {
	useEffect(() => {
		window.location.replace(window.location.href);
	}, []);

	return <ChatRouteBootstrapFallback />;
}

const rootRoute = createRootRoute({
	component: RootRouteComponent,
	notFoundComponent: () => <Navigate replace to="/chat" />,
});

const indexRoute = createRoute({
	component: () => <Navigate replace to="/chat" />,
	getParentRoute: () => rootRoute,
	path: "/",
});

const loginRoute = createRoute({
	component: CompatAuthRoute,
	getParentRoute: () => rootRoute,
	path: "/login",
});

const registerRoute = createRoute({
	component: CompatAuthRoute,
	getParentRoute: () => rootRoute,
	path: "/register",
});

const forgotPasswordRoute = createRoute({
	component: CompatAuthRoute,
	getParentRoute: () => rootRoute,
	path: "/forgot-password",
});

const resetPasswordRoute = createRoute({
	component: CompatAuthRoute,
	getParentRoute: () => rootRoute,
	path: "/reset-password",
});

const authenticatedRoute = createRoute({
	component: AuthenticatedChatRoute,
	getParentRoute: () => rootRoute,
	id: "authenticated",
});

const chatIndexRoute = createRoute({
	component: ChatRoutePage,
	getParentRoute: () => authenticatedRoute,
	path: "/chat",
});

const chatConversationRoute = createRoute({
	component: ChatRoutePage,
	getParentRoute: () => authenticatedRoute,
	path: "/chat/$conversationId",
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	loginRoute,
	registerRoute,
	forgotPasswordRoute,
	resetPasswordRoute,
	authenticatedRoute.addChildren([chatIndexRoute, chatConversationRoute]),
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
