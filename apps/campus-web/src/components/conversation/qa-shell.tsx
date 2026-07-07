import { AssistantRuntimeProvider, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { useNavigate } from "@tanstack/react-router";
import {
	type CSSProperties,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { ThreadListSidebar } from "@/components/assistant-ui/threadlist-sidebar";
import { AuthDialog } from "@/components/auth/auth-dialog";
import { QAAccountEntry } from "@/components/auth/user/qa-account-entry";
import { AssistantConversationSurface } from "@/components/conversation/assistant-conversation-surface";
import {
	ProductNavActions,
	ProductNavMobileMenu,
} from "@/components/navigation/product-navigation";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { createCampusAssistantRuntimeHook } from "@/features/conversation/assistant-ui-runtime";
import { createCampusAssistantThreadListAdapter } from "@/features/conversation/assistant-ui-thread-adapter";
import { campusAuthClient } from "@/platform/auth/client";

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
									<ProductNavActions
										activePath={activePath}
										className="hidden gap-1 md:flex"
										showIcons
										variant="chat"
									/>
									<ProductNavMobileMenu
										activePath={activePath}
										triggerClassName="md:hidden"
										variant="chat"
									/>
									{hasSession ? <QAAccountEntry /> : null}
									<AuthDialog
										onOpenChange={setAuthDialogOpen}
										open={authDialogOpen}
										trigger={hasSession ? undefined : <QAAccountEntry />}
										triggerAriaLabel={hasSession ? undefined : "登录"}
										triggerClassName={
											hasSession
												? undefined
												: "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-2 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:px-3"
										}
									/>
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
