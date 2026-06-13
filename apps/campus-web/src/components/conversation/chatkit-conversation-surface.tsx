import { ChatKit, useChatKit } from "@openai/chatkit-react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { CHATKIT_API_URL, CHATKIT_DOMAIN_KEY } from "@/features/conversation/chatkit-integration";

const START_SCREEN_PROMPTS = [
	{ icon: "map-pin", label: "找教学楼", prompt: "中慧楼在哪里？" },
	{ icon: "lifesaver", label: "问饭堂", prompt: "清真窗口在哪？" },
	{ icon: "calendar", label: "查通知", prompt: "最近有哪些通知？" },
	{ icon: "maps", label: "看饭堂分布", prompt: "海淀校区饭堂分布图在哪看？" },
] as const;

const ACTIVE_CHATKIT_REQUEST_TYPES = new Set([
	"threads.add_user_message",
	"threads.create",
	"threads.custom_action",
	"threads.retry_after_item",
	"threads.sync_custom_action",
]);

const CHATKIT_READY_TIMEOUT_MS = 8_000;

type ChatKitSurfaceStatus = "ready" | "runtime_unavailable" | "service_unavailable";

function getChatKitRequestType(init?: RequestInit): string | null {
	if (typeof init?.body !== "string") {
		return null;
	}
	try {
		const payload = JSON.parse(init.body) as { type?: unknown };
		return typeof payload.type === "string" ? payload.type : null;
	} catch {
		return null;
	}
}

function isActiveChatKitRequest(init?: RequestInit): boolean {
	const requestType = getChatKitRequestType(init);
	return requestType ? ACTIVE_CHATKIT_REQUEST_TYPES.has(requestType) : false;
}

export function ChatKitConversationSurface({
	initialThread,
	onLoginRequired,
}: {
	initialThread: string | null;
	onLoginRequired?: () => void;
}) {
	const navigate = useNavigate();
	const [ready, setReady] = useState(false);
	const [status, setStatus] = useState<ChatKitSurfaceStatus>("ready");
	const chatKitFetch = useCallback(
		async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const response = await fetch(input, {
				...init,
				credentials: "same-origin",
			});
			if (response.status === 401 && isActiveChatKitRequest(init)) {
				onLoginRequired?.();
			}
			if (response.status >= 500 && isActiveChatKitRequest(init)) {
				setStatus("service_unavailable");
			}
			return response;
		},
		[onLoginRequired],
	);
	const chatkit = useChatKit({
		api: {
			domainKey: CHATKIT_DOMAIN_KEY,
			fetch: chatKitFetch,
			url: CHATKIT_API_URL,
		},
		composer: {
			attachments: {
				enabled: false,
			},
			placeholder: "输入你想问的问题",
		},
		frameTitle: "MUC Campus Q&A",
		header: {
			enabled: false,
		},
		history: {
			enabled: true,
			showDelete: true,
			showRename: true,
		},
		initialThread,
		locale: "zh-CN",
		onError: ({ error }) => {
			console.error("Chat surface error", error);
		},
		onLog: ({ data, name }) => {
			console.info("Chat surface log", { data, name });
		},
		onReady: () => {
			setReady(true);
			setStatus("ready");
		},
		onThreadChange: ({ threadId }) => {
			void navigate(
				threadId ? { params: { conversationId: threadId }, to: "/c/$conversationId" } : { to: "/" },
			);
		},
		startScreen: {
			greeting: "想了解什么校园信息？",
			prompts: [...START_SCREEN_PROMPTS],
		},
		thread: {
			autoScroll: true,
		},
		threadItemActions: {
			feedback: true,
			retry: true,
		},
	});

	useEffect(() => {
		if (ready) {
			return;
		}
		const timeout = window.setTimeout(() => {
			setStatus("runtime_unavailable");
		}, CHATKIT_READY_TIMEOUT_MS);
		return () => window.clearTimeout(timeout);
	}, [ready]);

	useEffect(() => {
		function handleOpenHistory() {
			void chatkit.showHistory();
		}
		document.addEventListener("campus-chatkit-open-history-search", handleOpenHistory);
		return () => {
			document.removeEventListener("campus-chatkit-open-history-search", handleOpenHistory);
		};
	}, [chatkit]);

	if (status === "runtime_unavailable") {
		return (
			<ChatKitStatusPanel
				actionLabel="重新加载"
				message="对话界面暂时无法加载。"
				onAction={() => window.location.reload()}
			/>
		);
	}

	return (
		<div className="relative flex min-h-0 flex-1">
			<ChatKit className="h-full min-h-0 w-full" control={chatkit.control} />
			{status === "service_unavailable" ? (
				<div className="pointer-events-none absolute inset-x-4 bottom-4 z-10 flex justify-center">
					<div className="rounded-full border border-[var(--sys-border-subtle)] bg-white px-4 py-2 text-sm text-[var(--sys-text-muted)] shadow-[var(--shadow-sm)]">
						暂时无法发送，请稍后再试。
					</div>
				</div>
			) : null}
		</div>
	);
}

function ChatKitStatusPanel({
	actionLabel,
	message,
	onAction,
}: {
	actionLabel: string;
	message: string;
	onAction: () => void;
}) {
	return (
		<div className="flex min-h-0 flex-1 items-center justify-center px-6">
			<div className="w-full max-w-sm rounded-2xl border border-[var(--sys-border-subtle)] bg-white p-5 text-center shadow-[var(--shadow-sm)]">
				<p className="text-sm font-medium text-[var(--sys-text-strong)]">{message}</p>
				<button
					className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--sys-text-strong)] px-4 text-sm font-medium text-white hover:bg-[var(--sys-text-default)]"
					onClick={onAction}
					type="button"
				>
					{actionLabel}
				</button>
			</div>
		</div>
	);
}
