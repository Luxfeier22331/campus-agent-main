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
import { AccountEntry } from "@/components/auth/user/account-entry";
import { AssistantConversationSurface } from "@/components/conversation/assistant-conversation-surface";
import { CampusTopNav } from "@/components/navigation/campus-top-nav";
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { createCampusAssistantRuntimeHook } from "@/features/conversation/assistant-ui-runtime";
import { createCampusAssistantThreadListAdapter } from "@/features/conversation/assistant-ui-thread-adapter";
import { isEditableKeyboardTarget } from "@/lib/keyboard";
import { useCampusSession } from "@/platform/auth/session";

const CHAT_SIDEBAR_STORAGE_KEY = "campus-agent.chat-sidebar";

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
	const [chatSidebarOpen, setChatSidebarOpen] = useState(readChatSidebarOpen);
	const session = useCampusSession();
	const hasSession = session.status === "authenticated";
	const accountPending = session.status === "loading" || session.status === "unavailable";
	const activePath = readBrowserPathname();
	const openAuthDialog = useCallback(() => setAuthDialogOpen(true), []);
	const handleChatSidebarChange = useCallback((open: boolean) => {
		setChatSidebarOpen(open);
		writeChatSidebarOpen(open);
	}, []);

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
			if (
				!isEditableKeyboardTarget(event.target) &&
				commandKey &&
				event.shiftKey &&
				event.key.toLowerCase() === "o"
			) {
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
			loginRequired={session.status === "anonymous"}
			onLoginRequired={openAuthDialog}
			threadId={assistantThreadId}
		>
			<SidebarProvider
				onOpenChange={handleChatSidebarChange}
				open={chatSidebarOpen}
				style={
					{
						"--sidebar-width": "var(--layout-chat-sidebar-width)",
						"--sidebar-width-icon": "var(--layout-chat-sidebar-rail-width)",
					} as CSSProperties
				}
			>
				<ThreadListSidebar
					authenticated={hasSession}
					accountPending={accountPending}
					className="bg-sidebar"
					collapsible="icon"
					id="campus-chat-sidebar"
					onLoginRequired={openAuthDialog}
				/>
				<SidebarInset data-testid="assistant-chat">
					<div className="flex min-h-dvh flex-col bg-background text-foreground">
						<CampusTopNav
							activePath={activePath}
							contextLabel={topTitle}
							density="compact"
							leadingAction={<ChatSidebarTrigger />}
							mobileAccountAction={(openMobileAuthDialog) => (
								<AccountEntry
									className="w-full"
									onLogin={openMobileAuthDialog}
									presentation="label"
								/>
							)}
							variant="workspace"
						/>
						{authDialogOpen ? <AuthDialog onOpenChange={setAuthDialogOpen} open /> : null}
						<div className="min-h-0 flex-1">
							<AssistantConversationSurface />
						</div>
					</div>
				</SidebarInset>
			</SidebarProvider>
		</AssistantRemoteRuntimeFrame>
	);
}

function ChatSidebarTrigger() {
	const { isMobile, open, openMobile } = useSidebar();
	const panelOpen = isMobile ? openMobile : open;
	const label = isMobile
		? panelOpen
			? "关闭聊天记录"
			: "打开聊天记录"
		: panelOpen
			? "收起聊天记录"
			: "展开聊天记录";

	return (
		<SidebarTrigger
			aria-controls="campus-chat-sidebar"
			aria-label={label}
			className="shrink-0 lg:hidden"
			registerAsMobileOpener
		/>
	);
}

function readBrowserPathname(): string {
	if (typeof window === "undefined") {
		return "/";
	}
	return window.location.pathname;
}

function readChatSidebarOpen(): boolean {
	if (typeof window === "undefined") {
		return true;
	}

	try {
		return window.localStorage.getItem(CHAT_SIDEBAR_STORAGE_KEY) !== "collapsed";
	} catch {
		return true;
	}
}

function writeChatSidebarOpen(open: boolean): void {
	try {
		window.localStorage.setItem(CHAT_SIDEBAR_STORAGE_KEY, open ? "expanded" : "collapsed");
	} catch {
		return;
	}
}

function AssistantRemoteRuntimeFrame({
	children,
	enableRemoteHistory,
	loginRequired,
	onLoginRequired,
	threadId,
}: {
	children: ReactNode;
	enableRemoteHistory: boolean;
	loginRequired: boolean;
	onLoginRequired: () => void;
	threadId: string | null;
}) {
	const adapter = useMemo(
		() => createCampusAssistantThreadListAdapter({ enableRemoteHistory }),
		[enableRemoteHistory],
	);
	const runtimeHook = useMemo(
		() => createCampusAssistantRuntimeHook({ loginRequired, onLoginRequired }),
		[loginRequired, onLoginRequired],
	);
	const runtime = useRemoteThreadListRuntime({
		adapter,
		runtimeHook,
		threadId: threadId ?? undefined,
	});

	return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
