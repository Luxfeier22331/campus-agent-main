import { useAui, useAuiState } from "@assistant-ui/react";
import { Button, cn } from "@campus-agent/ui";
import { LoaderCircleIcon } from "lucide-react";
import { RetrievalStatus } from "@/components/conversation/retrieval-status";

export function ThreadRunStatus() {
	const aui = useAui();
	const active = useAuiState((state) => state.thread.isRunning && state.message.isLast);
	const hasText = useAuiState((state) =>
		state.message.content.some((part) => part.type === "text" && part.text.length > 0),
	);
	const connection = useAuiState(
		(state) =>
			(state.thread.extras as { connection?: string } | undefined)?.connection ?? "connected",
	);
	const retrieval = useAuiState(
		(state) =>
			(state.thread.extras as { retrieval?: Partial<Record<"campus", string>> } | undefined)
				?.retrieval,
	);
	if (!active) {
		return null;
	}
	return (
		<p
			aria-atomic="true"
			className={cn(
				"aui-thread-run-status flex flex-wrap items-center gap-2 text-sm leading-6",
				hasText && "mt-3",
				connection === "disconnected" ? "text-destructive" : "text-muted-foreground",
			)}
			data-connection={connection}
			role="status"
		>
			{connection === "disconnected" ? null : (
				<LoaderCircleIcon
					aria-hidden="true"
					className="size-4 animate-spin motion-reduce:animate-none"
				/>
			)}
			{connection === "disconnected" ? (
				"连接已断开"
			) : connection === "recovering" ? (
				"正在恢复连接"
			) : retrieval?.campus ? (
				<RetrievalStatus statuses={retrieval} />
			) : (
				"正在回答"
			)}
			{connection === "disconnected" ? (
				<Button
					type="button"
					variant="link"
					size="sm"
					className="h-auto px-1 py-0.5"
					onClick={() => void aui.thread().resumeRun({ parentId: null })}
				>
					恢复连接
				</Button>
			) : null}
		</p>
	);
}
