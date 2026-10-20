import { Card, Skeleton } from "@campus-agent/ui";

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
			<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-6">
				<div className="min-w-0">
					{includeHallSwitcher ? (
						<div className="mb-3 flex flex-col gap-2 sm:flex-row sm:gap-3">
							<Skeleton className="h-11 w-full sm:w-56" />
							<Skeleton className="h-11 min-w-0 flex-1" />
						</div>
					) : null}
					<Card asChild>
						<div className="p-3 sm:p-4" data-testid="dining-map-skeleton">
							<Skeleton className="h-11 w-48" />
							<Skeleton className="mt-3 aspect-[16/10] w-full" />
						</div>
					</Card>
				</div>
				<Card asChild>
					<div className="hidden space-y-4 p-5 lg:block" data-testid="dining-detail-skeleton">
						<Skeleton className="h-7 w-32" />
						<Skeleton className="h-4 w-24" />
						<Skeleton className="h-24 w-full" />
					</div>
				</Card>
			</div>
		</div>
	);
}

export function DiningRoutePending() {
	return (
		<section className="mx-auto max-w-[var(--layout-page-workspace-width)] px-4 py-4 pb-24 sm:px-5 sm:py-6 lg:px-6">
			<h1 className="ui-page-title">食堂</h1>
			<DiningPageSkeleton includeHallSwitcher />
		</section>
	);
}
