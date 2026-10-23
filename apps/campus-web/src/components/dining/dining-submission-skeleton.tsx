export function DiningSubmissionSkeleton({
	label,
	detail = false,
}: {
	label: string;
	detail?: boolean;
}) {
	return (
		<div aria-busy="true" aria-label={label} className="space-y-5 py-5" role="status">
			<div aria-hidden="true" className="space-y-3 motion-safe:animate-pulse">
				<div className="h-5 w-2/3 rounded bg-surface-muted" />
				<div className="h-4 w-1/2 rounded bg-surface-muted" />
				{detail ? <div className="h-40 rounded bg-surface-muted" /> : null}
				<div className="h-5 w-3/4 rounded bg-surface-muted" />
				<div className="h-4 w-1/2 rounded bg-surface-muted" />
			</div>
		</div>
	);
}
