import { AssistantRuntimeProvider, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { useNavigate } from "@tanstack/react-router";
import {
	type CSSProperties,
	lazy,
	type ReactNode,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { ThreadListSidebar } from "@/components/assistant-ui/threadlist-sidebar";
import { AccountEntry } from "@/components/auth/user/account-entry";
import { AssistantConversationSurface } from "@/components/conversation/assistant-conversation-surface";
import {
	ProductNavActionsWithIcons,
	ProductNavMobileMenu,
} from "@/components/navigation/product-navigation-menu";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { createCampusAssistantRuntimeHook } from "@/features/conversation/assistant-ui-runtime";
import { createCampusAssistantThreadListAdapter } from "@/features/conversation/assistant-ui-thread-adapter";
import { campusAuthClient } from "@/platform/auth/client";

const AuthDialog = lazy(() =>
	import("@/components/auth/auth-dialog").then((module) => ({ default: module.AuthDialog })),
);

export function QAShell({
	assistantThreadId,
	loginRequested,
	topTitle,
}: {
	assistantThreadId: string | null;
	loginRequested?: boolean;
	topTitle: string;
}) {
	const navigate = useNavigate();
	const [authDialogOpen, setAuthDialogOpen] = useState(false);
	const session = campusAuthClient.useSession();
	const hasSession = Boolean(session.data);
	const activePath = readBrowserPathname();
	const openAuthDialog = useCallback(() => setAuthDialogOpen(true), []);

	useEffect(() => {
		if (loginRequested) {
			openAuthDialog();
		}
	}, [loginRequested, openAuthDialog]);

	useEffect(() => {
		if (hasSession) {
			setAuthDialogOpen(false);
		}
	}, [hasSession]);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			const commandKey = event.metaKey || event.ctrlKey;
			if (commandKey && event.shiftKey && event.key.toLowerCase() === "o") {
				event.preventDefault();
				void navigate({ to: "/" });
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [navigate]);

	return (
		<AssistantRemoteRuntimeFrame
			enableRemoteHistory={hasSession}
			onLoginRequired={openAuthDialog}
			threadId={assistantThreadId}
		>
			<SidebarProvider>
				<ThreadListSidebar
					className="bg-sidebar"
					collapsible="offcanvas"
					onLoginRequired={openAuthDialog}
					style={
						{
							"--sidebar-width": "var(--layout-chat-sidebar-width)",
						} as CSSProperties
					}
				/>
				<SidebarInset data-testid="assistant-chat">
					<div className="flex min-h-dvh flex-col bg-background text-foreground">
						<header className="shrink-0 border-b bg-background/95 px-3 backdrop-blur-sm sm:px-4 lg:px-5">
							<div className="flex min-h-14 items-center justify-between gap-3">
								<div className="flex min-w-0 items-center gap-3">
									<SidebarTrigger aria-label="打开聊天记录" className="lg:hidden" />
									<div className="min-w-0">
										<p className="truncate text-sm font-semibold text-foreground">
											中央民族大学校园问答
										</p>
										<p className="truncate text-xs text-muted-foreground">{topTitle}</p>
									</div>
								</div>
								<div className="flex min-w-0 items-center gap-1 sm:gap-2">
									<ProductNavActionsWithIcons
										activePath={activePath}
										className="hidden gap-1 md:flex"
										variant="chat"
									/>
									<ProductNavMobileMenu
										activePath={activePath}
										triggerClassName="md:hidden"
										variant="chat"
									/>
									<AccountEntry
										authenticated={hasSession}
										onLogin={openAuthDialog}
										pending={session.isPending}
									/>
									{authDialogOpen ? (
										<Suspense fallback={null}>
											<AuthDialog onOpenChange={setAuthDialogOpen} open />
										</Suspense>
									) : null}
								</div>
							</div>
						</header>
						<div className="min-h-0 flex-1">
							<AssistantConversationSurface />
						</div>
					</div>
				</SidebarInset>
			</SidebarProvider>
		</AssistantRemoteRuntimeFrame>
	);
}

function readBrowserPathname(): string {
	if (typeof window === "undefined") {
		return "/";
	}
	return window.location.pathname;
}

function AssistantRemoteRuntimeFrame({
	children,
	enableRemoteHistory,
	onLoginRequired,
	threadId,
}: {
	children: ReactNode;
	enableRemoteHistory: boolean;
	onLoginRequired: () => void;
	threadId: string | null;
}) {
	const adapter = useMemo(
		() => createCampusAssistantThreadListAdapter({ enableRemoteHistory }),
		[enableRemoteHistory],
	);
	const runtimeHook = useMemo(
		() => createCampusAssistantRuntimeHook({ hasSession: enableRemoteHistory, onLoginRequired }),
		[enableRemoteHistory, onLoginRequired],
	);
	const runtime = useRemoteThreadListRuntime({
		adapter,
		runtimeHook,
		threadId: threadId ?? undefined,
	});

	return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
