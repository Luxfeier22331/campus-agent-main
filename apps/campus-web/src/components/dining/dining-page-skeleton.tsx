import { Skeleton } from "@/components/ui/skeleton";

export function DiningPageSkeleton({
	includeHallSwitcher = false,
}: {
	includeHallSwitcher?: boolean;
}) {
	const label = includeHallSwitcher ? "正在读取食堂数据" : "正在读取食堂地图";

	return (
		<div
			aria-busy="true"
			aria-label={label}
			className="mt-4 space-y-6"
			data-testid="dining-page-skeleton"
			role="status"
		>
			<span className="sr-only">{label}</span>
			{includeHallSwitcher ? <Skeleton className="h-11 w-full sm:w-80" /> : null}
			<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6">
				<div
					className="rounded-lg border border-border/80 bg-card p-3 sm:p-4"
					data-testid="dining-map-skeleton"
				>
					<div className="flex items-center gap-3">
						<Skeleton className="h-10 min-w-0 flex-1" />
						<Skeleton className="size-10 shrink-0" />
					</div>
					<Skeleton className="mt-3 aspect-[16/10] w-full" />
				</div>
				<div className="space-y-4 py-1" data-testid="dining-detail-skeleton">
					<Skeleton className="h-7 w-32" />
					<Skeleton className="h-4 w-full" />
					<Skeleton className="h-4 w-4/5" />
					<Skeleton className="h-24 w-full" />
				</div>
			</div>
			<div>
				<Skeleton className="h-6 w-20" />
				<Skeleton className="mt-4 h-20 w-full" />
			</div>
		</div>
	);
}

export function DiningRoutePending() {
	return (
		<section className="mx-auto max-w-[var(--layout-page-workspace-width)] px-4 py-4 pb-24 sm:px-5 sm:py-6 lg:px-6">
			<h1 className="text-2xl font-semibold tracking-normal text-[var(--sys-text-strong)] md:text-3xl">
				食堂
			</h1>
			<DiningPageSkeleton includeHallSwitcher />
		</section>
	);
}
