import { AssistantRuntimeProvider, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { useDataStreamRuntime } from "@assistant-ui/react-data-stream";
import { Link, useNavigate } from "@tanstack/react-router";
import { BookOpen, MapIcon, Send, Utensils } from "lucide-react";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo } from "react";
import { ThreadListSidebar } from "@/components/assistant-ui/threadlist-sidebar";
import { UserButton } from "@/components/auth/user/user-button";
import { AssistantConversationSurface } from "@/components/conversation/assistant-conversation-surface";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { createCampusAssistantThreadListAdapter } from "@/features/conversation/assistant-ui-thread-adapter";

const supportNavItems = [
	{ icon: BookOpen, label: "文档", to: "/docs" },
	{ icon: MapIcon, label: "校园地图", to: "/map" },
	{ icon: Utensils, label: "食堂", to: "/dining" },
	{ emphasis: true, icon: Send, label: "反馈", to: "/feedback" },
] as const;

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
	const navigateToLogin = useCallback(() => {
		void navigate({
			search: { redirectTo: readCurrentRouteTarget() },
			to: "/account/login",
		});
	}, [navigate]);

	useEffect(() => {
		if (loginRequested) {
			navigateToLogin();
		}
	}, [loginRequested, navigateToLogin]);

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
		<AssistantRemoteRuntimeFrame onLoginRequired={navigateToLogin} threadId={assistantThreadId}>
			<SidebarProvider>
				<ThreadListSidebar
					className="bg-sidebar"
					collapsible="offcanvas"
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
									<nav aria-label="支撑页面导航" className="hidden items-center gap-1 md:flex">
										{supportNavItems.map((item) => (
											<Button
												asChild
												className={[
													"min-h-8 rounded-md px-2 text-xs text-muted-foreground",
													"emphasis" in item && item.emphasis
														? "text-[var(--sys-brand-identity)] hover:text-[var(--sys-brand-identity)]"
														: "",
												].join(" ")}
												key={item.to}
												size="sm"
												variant="ghost"
											>
												<Link to={item.to}>
													<item.icon aria-hidden="true" className="size-4" />
													<span>{item.label}</span>
												</Link>
											</Button>
										))}
									</nav>
									<UserButton />
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

function readCurrentRouteTarget(): string {
	if (typeof window === "undefined") {
		return "/";
	}
	return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function AssistantRemoteRuntimeFrame({
	children,
	onLoginRequired,
	threadId,
}: {
	children: ReactNode;
	onLoginRequired: () => void;
	threadId: string | null;
}) {
	const adapter = useMemo(() => createCampusAssistantThreadListAdapter(), []);
	const runtimeHook = useMemo(
		() => createCampusDataStreamRuntimeHook(onLoginRequired),
		[onLoginRequired],
	);
	const runtime = useRemoteThreadListRuntime({
		adapter,
		runtimeHook,
		threadId: threadId ?? undefined,
	});

	return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

function createCampusDataStreamRuntimeHook(onLoginRequired: () => void) {
	return function useCampusDataStreamRuntime() {
		return useDataStreamRuntime({
			api: "/api/chat/assistant-ui",
			credentials: "same-origin",
			onResponse: (response) => {
				if (response.status === 401) {
					onLoginRequired();
				}
			},
			protocol: "data-stream",
			sendExtraMessageFields: true,
		});
	};
}
