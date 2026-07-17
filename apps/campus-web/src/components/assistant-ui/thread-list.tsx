import {
	AuiIf,
	ThreadListItemMorePrimitive,
	ThreadListItemPrimitive,
	ThreadListPrimitive,
	useAuiState,
	useThreadListItemRuntime,
} from "@assistant-ui/react";
import { ArchiveIcon, MoreHorizontalIcon, PlusIcon, TrashIcon } from "lucide-react";
import { type FC, Fragment, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const ThreadList: FC = () => {
	const [actionError, setActionError] = useState<string | null>(null);

	return (
		<ThreadListPrimitive.Root className="aui-root aui-thread-list-root flex flex-col gap-0.5">
			<ThreadListNew />
			{actionError ? (
				<p role="alert" className="text-destructive px-2.5 py-1 text-xs">
					{actionError}
				</p>
			) : null}
			<AuiIf condition={(s) => s.threads.isLoading}>
				<ThreadListSkeleton />
			</AuiIf>
			<AuiIf condition={(s) => !s.threads.isLoading}>
				<ThreadListItems onActionError={setActionError} />
			</AuiIf>
		</ThreadListPrimitive.Root>
	);
};

const DAY_IN_MS = 86_400_000;
const SKELETON_THREAD_IDS = ["thread-1", "thread-2", "thread-3", "thread-4", "thread-5"] as const;

const dateGroupLabel = (date: Date | undefined, startOfToday: number): string => {
	if (!date || date.getTime() >= startOfToday) {
		return "今天";
	}
	if (date.getTime() >= startOfToday - DAY_IN_MS) {
		return "昨天";
	}
	return "更早";
};

interface ThreadListGroup {
	label: string;
	indices: number[];
}

interface ThreadListActionErrorProps {
	onActionError: (message: string | null) => void;
}

const ThreadListItems: FC<ThreadListActionErrorProps> = ({ onActionError }) => {
	const threadIds = useAuiState((s) => s.threads.threadIds);
	const threadItems = useAuiState((s) => s.threads.threadItems);

	const groups = useMemo<ThreadListGroup[] | null>(() => {
		const itemsById = new Map(threadItems.map((item) => [item.id, item]));
		const dates = threadIds.map((id) => itemsById.get(id)?.lastMessageAt);
		if (!dates.some(Boolean)) {
			return null;
		}

		const now = new Date();
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
		const time = (index: number) => dates[index]?.getTime() ?? Number.MAX_SAFE_INTEGER;
		const indices = threadIds.map((_, index) => index).sort((a, b) => time(b) - time(a));

		const result: ThreadListGroup[] = [];
		for (const index of indices) {
			const label = dateGroupLabel(dates[index], startOfToday);
			const lastGroup = result.at(-1);
			if (lastGroup?.label === label) {
				lastGroup.indices.push(index);
			} else {
				result.push({ label, indices: [index] });
			}
		}
		return result;
	}, [threadIds, threadItems]);

	if (!groups) {
		return (
			<ThreadListPrimitive.Items>
				{() => <ThreadListItem onActionError={onActionError} />}
			</ThreadListPrimitive.Items>
		);
	}

	const ThreadListItemWithError = () => <ThreadListItem onActionError={onActionError} />;

	return groups.map((group) => (
		<Fragment key={group.label}>
			<div className="aui-thread-list-group-label text-muted-foreground px-2.5 pt-3 pb-1 text-xs font-medium">
				{group.label}
			</div>
			{group.indices.map((index) => (
				<ThreadListPrimitive.ItemByIndex
					key={threadIds[index]}
					index={index}
					components={{ ThreadListItem: ThreadListItemWithError }}
				/>
			))}
		</Fragment>
	));
};

const ThreadListNew: FC = () => (
	<ThreadListPrimitive.New asChild>
		<Button
			variant="ghost"
			className="aui-thread-list-new hover:bg-surface-muted data-active:bg-surface-muted h-8 justify-start gap-2 rounded-md px-2.5 text-sm font-normal"
		>
			<PlusIcon className="size-4" />
			新对话
		</Button>
	</ThreadListPrimitive.New>
);

const ThreadListSkeleton: FC = () => (
	<div className="flex flex-col gap-0.5">
		{SKELETON_THREAD_IDS.map((id) => (
			<div
				key={id}
				role="status"
				aria-label="正在加载聊天记录"
				className="aui-thread-list-skeleton-wrapper flex h-8 items-center px-2.5"
			>
				<Skeleton className="aui-thread-list-skeleton h-3.5 w-full" />
			</div>
		))}
	</div>
);

const ThreadListItem: FC<ThreadListActionErrorProps> = ({ onActionError }) => (
	<ThreadListItemPrimitive.Root className="aui-thread-list-item group hover:bg-surface-muted focus-visible:bg-surface-muted data-active:bg-surface-muted relative flex h-8 items-center rounded-md transition-colors focus-visible:outline-none">
		<ThreadListItemPrimitive.Trigger className="aui-thread-list-item-trigger flex h-full min-w-0 flex-1 items-center px-2.5 text-start text-sm group-hover:pe-9 group-has-data-[state=open]:pe-9 group-data-active:pe-9">
			<span className="aui-thread-list-item-title min-w-0 flex-1 truncate">
				<ThreadListItemPrimitive.Title fallback="新对话" />
			</span>
		</ThreadListItemPrimitive.Trigger>
		<ThreadListItemMore onActionError={onActionError} />
	</ThreadListItemPrimitive.Root>
);

const ThreadListItemMore: FC<ThreadListActionErrorProps> = ({ onActionError }) => {
	const runtime = useThreadListItemRuntime();
	const [isActionPending, setIsActionPending] = useState(false);

	const runThreadAction = async (action: () => Promise<void>, failureMessage: string) => {
		onActionError(null);
		setIsActionPending(true);
		try {
			await action();
		} catch {
			onActionError(failureMessage);
		} finally {
			setIsActionPending(false);
		}
	};

	return (
		<ThreadListItemMorePrimitive.Root>
			<ThreadListItemMorePrimitive.Trigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="aui-thread-list-item-more data-[state=open]:bg-accent absolute end-1.5 top-1/2 size-6 -translate-y-1/2 p-0 opacity-0 group-hover:opacity-100 group-data-active:opacity-100 data-[state=open]:opacity-100"
				>
					<MoreHorizontalIcon className="size-3.5" />
					<span className="sr-only">更多操作</span>
				</Button>
			</ThreadListItemMorePrimitive.Trigger>
			<ThreadListItemMorePrimitive.Content
				side="right"
				align="start"
				sideOffset={6}
				className="aui-thread-list-item-more-content bg-popover/95 text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-xl border p-1.5 shadow-lg backdrop-blur-sm"
			>
				<ThreadListItemMorePrimitive.Item
					disabled={isActionPending}
					onSelect={(event) => {
						event.preventDefault();
						void runThreadAction(runtime.archive, "归档失败，请稍后重试。");
					}}
					className="aui-thread-list-item-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50"
				>
					<ArchiveIcon className="size-4" />
					归档
				</ThreadListItemMorePrimitive.Item>
				<ThreadListItemMorePrimitive.Item
					disabled={isActionPending}
					onSelect={(event) => {
						event.preventDefault();
						void runThreadAction(runtime.delete, "删除失败，请稍后重试。");
					}}
					className="aui-thread-list-item-more-item text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50"
				>
					<TrashIcon className="size-4" />
					删除
				</ThreadListItemMorePrimitive.Item>
			</ThreadListItemMorePrimitive.Content>
		</ThreadListItemMorePrimitive.Root>
	);
};
