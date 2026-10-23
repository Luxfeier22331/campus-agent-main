import { Skeleton } from "@campus-agent/ui";

export function NoticeListSkeleton(props: { itemLabel: string }) {
	const rows = ["first", "second", "third", "fourth", "fifth", "sixth"];
	return (
		<div aria-label={`正在读取${props.itemLabel}`} className="space-y-1 py-1" role="status">
			{rows.map((row) => (
				<div
					className="grid min-h-20 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 rounded-lg px-3 py-3.5"
					key={row}
				>
					<Skeleton className="h-5 w-4/5" />
					<Skeleton className="size-4" />
					<Skeleton className="col-span-2 h-4 w-72 max-w-full" />
				</div>
			))}
		</div>
	);
}
