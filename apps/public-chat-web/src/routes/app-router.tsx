import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { ForgotPasswordPage } from "../login/forgot-password-page";
import { LoginPage } from "../login/page";
import { RegisterPage } from "../login/register-page";
import { ResetPasswordPage } from "../login/reset-password-page";
import {
  ChatbotShellRuntimeProvider,
  useChatbotShellRuntime,
} from "@platform/chat/runtime";

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
  return <div className="flex h-dvh bg-sidebar" />;
}

function AuthenticatedChatRouteGuard() {
  const { session } = useChatbotShellRuntime();

  if (session.kind === "loading") {
    return <ChatRouteBootstrapFallback />;
  }

  if (session.kind === "unauthenticated") {
    return <Navigate replace to="/login" />;
  }

  if (session.kind === "error") {
    return <Navigate replace to="/login" />;
  }

  if (!session.principal.canChat) {
    return <Navigate replace to="/login" />;
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
  component: LoginPage,
  getParentRoute: () => rootRoute,
  path: "/login",
});

const registerRoute = createRoute({
  component: RegisterPage,
  getParentRoute: () => rootRoute,
  path: "/register",
});

const forgotPasswordRoute = createRoute({
  component: ForgotPasswordPage,
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
});

const resetPasswordRoute = createRoute({
  component: ResetPasswordPage,
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
