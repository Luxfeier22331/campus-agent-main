import type { DataMessagePartProps } from "@assistant-ui/react";
import type { SourceItemPayload } from "@/features/conversation/model";

export interface SourceItemsPayload {
	sourceItems: SourceItemPayload[];
	type: "source_items";
}

export function SourceItemsDataPart({ data }: DataMessagePartProps<SourceItemsPayload>) {
	return <SourceItemsList sourceItems={data.sourceItems} />;
}

export function SourceItemsList({ sourceItems }: { sourceItems: SourceItemPayload[] }) {
	if (sourceItems.length === 0) {
		return null;
	}

	return (
		<section aria-label="来源" className="mt-3 flex flex-col gap-2">
			{sourceItems.map((sourceItem) => (
				<SourceItemCard key={sourceItemKey(sourceItem)} sourceItem={sourceItem} />
			))}
		</section>
	);
}

function sourceItemKey(sourceItem: SourceItemPayload) {
	return [sourceItem.primaryAction.href, sourceItem.title, sourceItem.sectionTitle]
		.filter(Boolean)
		.join(":");
}

function SourceItemCard({ sourceItem }: { sourceItem: SourceItemPayload }) {
	const metadata = [sourceItem.collectionLabel, sourceItem.versionLabel].filter(Boolean);

	return (
		<div className="border-border/70 bg-surface-muted/20 rounded-md border px-3 py-2">
			<div className="flex min-w-0 items-start justify-between gap-3">
				<div className="flex min-w-0 items-start gap-2">
					<span
						aria-label={`引用 ${sourceItem.citationIndexes.join("、")}`}
						className="text-muted-foreground shrink-0 text-sm font-medium"
						role="img"
					>
						{sourceItem.citationIndexes.map((index) => `[${index}]`).join(" ")}
					</span>
					<div className="min-w-0">
						<p className="text-foreground line-clamp-2 text-sm font-medium">{sourceItem.title}</p>
						{metadata.length > 0 ? (
							<p className="text-muted-foreground mt-1 line-clamp-1 text-xs">
								{metadata.join(" · ")}
							</p>
						) : null}
					</div>
				</div>
				<SourceItemAction sourceItem={sourceItem} />
			</div>
			{sourceItem.sectionTitle ? (
				<p className="text-muted-foreground mt-1 line-clamp-1 text-xs">{sourceItem.sectionTitle}</p>
			) : null}
			{sourceItem.snippet ? (
				<p className="text-muted-foreground mt-2 line-clamp-3 text-sm">{sourceItem.snippet}</p>
			) : null}
		</div>
	);
}

function SourceItemAction({ sourceItem }: { sourceItem: SourceItemPayload }) {
	const action = sourceItem.primaryAction;
	return (
		<a
			className="border-border text-foreground hover:bg-accent hover:text-accent-foreground inline-flex h-8 shrink-0 items-center rounded-md border px-2 text-xs font-medium transition-colors"
			href={action.href}
		>
			{action.label}
		</a>
	);
}
