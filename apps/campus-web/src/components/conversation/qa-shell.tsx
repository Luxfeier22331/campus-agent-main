import { AssistantRuntimeProvider, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { useDataStreamRuntime } from "@assistant-ui/react-data-stream";
import { useNavigate } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import { UserButton } from "@/components/auth/user/user-button";
import { AssistantConversationSurface } from "@/components/conversation/assistant-conversation-surface";
import { SupportNavigation } from "@/components/conversation/support-navigation";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { createCampusAssistantThreadListAdapter } from "@/features/conversation/assistant-ui-thread-adapter";

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
	const [mobileThreadListOpen, setMobileThreadListOpen] = useState(false);
	const navigateToLogin = useCallback(() => {
		setMobileThreadListOpen(false);
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
			<div className="flex min-h-dvh flex-col bg-background text-foreground">
				<header className="shrink-0 border-b bg-background/95 px-4 backdrop-blur-sm lg:px-5">
					<div className="flex min-h-14 items-center justify-between gap-3">
						<div className="flex min-w-0 items-center gap-3">
							<Button
								aria-label="打开聊天记录"
								className="lg:hidden"
								onClick={() => setMobileThreadListOpen(true)}
								size="icon-lg"
								type="button"
								variant="ghost"
							>
								<Menu aria-hidden="true" className="size-5" />
							</Button>
							<div className="min-w-0">
								<p className="truncate text-sm font-semibold text-foreground">
									中央民族大学校园问答
								</p>
								<p className="truncate text-xs text-muted-foreground">{topTitle}</p>
							</div>
						</div>
						<div className="flex min-w-0 items-center gap-3">
							<SupportNavigation className="hidden md:flex" />
							<UserButton />
						</div>
					</div>
				</header>
				<div className="grid min-h-0 flex-1 lg:grid-cols-[var(--layout-chat-sidebar-width)_minmax(0,1fr)]">
					<aside className="hidden min-h-0 border-r bg-[var(--chat-sidebar-bg)] px-2.5 py-3 lg:block">
						<h2 className="px-2.5 pb-2 text-xs font-medium text-muted-foreground">聊天记录</h2>
						<ThreadList />
					</aside>
					<main className="min-h-0 min-w-0" data-testid="assistant-chat">
						<AssistantConversationSurface />
					</main>
				</div>
				<MobileThreadList onOpenChange={setMobileThreadListOpen} open={mobileThreadListOpen} />
			</div>
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

function MobileThreadList({
	onOpenChange,
	open,
}: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	return (
		<Sheet onOpenChange={onOpenChange} open={open}>
			<SheetContent
				className="w-[min(88vw,var(--layout-chat-sidebar-width))] bg-[var(--chat-sidebar-bg)] p-0 lg:hidden"
				closeLabel="关闭聊天记录"
				side="left"
			>
				<SheetHeader className="border-b px-3 py-3">
					<SheetTitle>聊天记录</SheetTitle>
				</SheetHeader>
				<div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
					<h2 className="px-2.5 pb-2 text-xs font-medium text-muted-foreground">聊天记录</h2>
					<ThreadList />
				</div>
			</SheetContent>
		</Sheet>
	);
}
