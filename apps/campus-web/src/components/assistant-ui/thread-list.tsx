import {
	AuiIf,
	ThreadListItemMorePrimitive,
	ThreadListItemPrimitive,
	ThreadListPrimitive,
	useAuiState,
} from "@assistant-ui/react";
import { useNavigate } from "@tanstack/react-router";
import { ArchiveIcon, MoreHorizontalIcon, PlusIcon, RotateCcwIcon, TrashIcon } from "lucide-react";
import { type FC, Fragment, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const ThreadList: FC = () => (
	<ThreadListPrimitive.Root className="aui-root aui-thread-list-root flex flex-col gap-0.5">
		<ThreadListNew />
		<AuiIf condition={(s) => s.threads.isLoading}>
			<ThreadListSkeleton />
		</AuiIf>
		<AuiIf condition={(s) => !s.threads.isLoading}>
			<ThreadListItems />
			<ArchivedThreadListItems />
		</AuiIf>
	</ThreadListPrimitive.Root>
);

const DAY_IN_MS = 86_400_000;

function dateGroupLabel(date: Date | undefined, startOfToday: number): string {
	if (!date || date.getTime() >= startOfToday) {
		return "今天";
	}
	if (date.getTime() >= startOfToday - DAY_IN_MS) {
		return "昨天";
	}
	return "更早";
}

interface ThreadListGroup {
	label: string;
	indices: number[];
}

const skeletonItemIds = [
	"thread-list-skeleton-1",
	"thread-list-skeleton-2",
	"thread-list-skeleton-3",
	"thread-list-skeleton-4",
	"thread-list-skeleton-5",
] as const;

const ThreadListItems: FC = () => {
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
				result.push({ indices: [index], label });
			}
		}
		return result;
	}, [threadIds, threadItems]);

	if (!groups) {
		return <ThreadListPrimitive.Items>{() => <ThreadListItem />}</ThreadListPrimitive.Items>;
	}

	return groups.map((group) => (
		<Fragment key={group.label}>
			<div className="aui-thread-list-group-label px-2.5 pt-3 pb-1 text-xs font-medium text-muted-foreground">
				{group.label}
			</div>
			{group.indices.map((index) => (
				<ThreadListPrimitive.ItemByIndex
					components={{ ThreadListItem }}
					index={index}
					key={threadIds[index]}
				/>
			))}
		</Fragment>
	));
};

const ArchivedThreadListItems: FC = () => (
	<div className="mt-4 border-t pt-3">
		<div className="aui-thread-list-group-label px-2.5 pb-1 text-xs font-medium text-muted-foreground">
			已归档
		</div>
		<ThreadListPrimitive.Items archived>
			{() => <ArchivedThreadListItem />}
		</ThreadListPrimitive.Items>
	</div>
);

const ThreadListNew: FC = () => {
	const navigate = useNavigate();

	return (
		<ThreadListPrimitive.New asChild>
			<Button
				className="aui-thread-list-new h-8 justify-start gap-2 rounded-md px-2.5 text-sm font-normal hover:bg-muted data-active:bg-muted"
				onClick={() => {
					void navigate({ to: "/" });
				}}
				variant="ghost"
			>
				<PlusIcon className="size-4" />
				新对话
			</Button>
		</ThreadListPrimitive.New>
	);
};

const ThreadListSkeleton: FC = () => (
	<div className="flex flex-col gap-0.5">
		{skeletonItemIds.map((itemId) => (
			<div
				aria-label="正在加载会话"
				className="aui-thread-list-skeleton-wrapper flex h-8 items-center px-2.5"
				key={itemId}
				role="status"
			>
				<Skeleton className="aui-thread-list-skeleton h-3.5 w-full" />
			</div>
		))}
	</div>
);

const ThreadListItem: FC = () => {
	const navigate = useNavigate();
	const remoteId = useAuiState((s) => s.threadListItem.remoteId);

	return (
		<ThreadListItemPrimitive.Root className="aui-thread-list-item group relative flex h-8 items-center rounded-md transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none data-active:bg-muted">
			<ThreadListItemPrimitive.Trigger
				className="aui-thread-list-item-trigger flex h-full min-w-0 flex-1 items-center px-2.5 text-start text-sm group-hover:pe-9 group-data-active:pe-9 group-has-data-[state=open]:pe-9"
				onClick={() => {
					if (remoteId) {
						void navigate({ params: { conversationId: remoteId }, to: "/c/$conversationId" });
					}
				}}
			>
				<span className="aui-thread-list-item-title min-w-0 flex-1 truncate">
					<ThreadListItemPrimitive.Title fallback="新对话" />
				</span>
			</ThreadListItemPrimitive.Trigger>
			<ThreadListItemMore />
		</ThreadListItemPrimitive.Root>
	);
};

const ArchivedThreadListItem: FC = () => (
	<ThreadListItemPrimitive.Root className="aui-thread-list-item group relative flex h-8 items-center rounded-md transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none data-active:bg-muted">
		<ThreadListItemPrimitive.Trigger className="aui-thread-list-item-trigger flex h-full min-w-0 flex-1 items-center px-2.5 text-start text-sm group-hover:pe-9 group-has-data-[state=open]:pe-9">
			<span className="aui-thread-list-item-title min-w-0 flex-1 truncate">
				<ThreadListItemPrimitive.Title fallback="已归档对话" />
			</span>
		</ThreadListItemPrimitive.Trigger>
		<ThreadListItemPrimitive.Unarchive asChild>
			<Button
				aria-label="恢复归档对话"
				className="aui-thread-list-item-more absolute end-1.5 top-1/2 size-6 -translate-y-1/2 p-0 opacity-0 group-hover:opacity-100"
				size="icon"
				variant="ghost"
			>
				<RotateCcwIcon className="size-3.5" />
			</Button>
		</ThreadListItemPrimitive.Unarchive>
	</ThreadListItemPrimitive.Root>
);

const ThreadListItemMore: FC = () => (
	<ThreadListItemMorePrimitive.Root>
		<ThreadListItemMorePrimitive.Trigger asChild>
			<Button
				className="aui-thread-list-item-more absolute end-1.5 top-1/2 size-6 -translate-y-1/2 p-0 opacity-0 group-hover:opacity-100 group-data-active:opacity-100 data-[state=open]:bg-accent data-[state=open]:opacity-100"
				size="icon"
				variant="ghost"
			>
				<MoreHorizontalIcon className="size-3.5" />
				<span className="sr-only">更多选项</span>
			</Button>
		</ThreadListItemMorePrimitive.Trigger>
		<ThreadListItemMorePrimitive.Content
			align="start"
			className="aui-thread-list-item-more-content z-50 min-w-[8rem] overflow-hidden rounded-xl border bg-popover/95 p-1.5 text-popover-foreground shadow-lg backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
			side="right"
			sideOffset={6}
		>
			<ThreadListItemPrimitive.Archive asChild>
				<ThreadListItemMorePrimitive.Item className="aui-thread-list-item-more-item flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
					<ArchiveIcon className="size-4" />
					归档
				</ThreadListItemMorePrimitive.Item>
			</ThreadListItemPrimitive.Archive>
			<ThreadListItemPrimitive.Delete asChild>
				<ThreadListItemMorePrimitive.Item className="aui-thread-list-item-more-item flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-destructive outline-none select-none hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive">
					<TrashIcon className="size-4" />
					删除
				</ThreadListItemMorePrimitive.Item>
			</ThreadListItemPrimitive.Delete>
		</ThreadListItemMorePrimitive.Content>
	</ThreadListItemMorePrimitive.Root>
);
