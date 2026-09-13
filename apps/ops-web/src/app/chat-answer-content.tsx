import { cn } from "@campus-agent/ui";
import type { ChatSourceItem } from "campus-contracts/chat-sources";
import { useId } from "react";
import { SafeMarkdown } from "./ui/safe-markdown";

export function ChatAnswerBody({ text, kind }: { text: string; kind: "answer" | "error" }) {
	return (
		<div
			className={cn(
				"min-w-0 break-words",
				kind === "error" && "border border-danger/30 bg-danger-subtle p-4 text-danger",
			)}
			role={kind === "error" ? "alert" : undefined}
		>
			{kind === "error" ? <p className="mb-2 font-semibold">错误结果已写入会话</p> : null}
			<SafeMarkdown>{text}</SafeMarkdown>
		</div>
	);
}

export function ChatAnswerSources({ sources }: { sources: ChatSourceItem[] }) {
	const titleId = useId();
	if (sources.length === 0) {
		return null;
	}
	return (
		<section aria-labelledby={titleId}>
			<h2 className="mb-4 font-semibold text-foreground text-lg" id={titleId}>
				回答来源
			</h2>
			<ul className="divide-y divide-border border-border border-y">
				{sources.map((source, sourceIndex) => (
					<li
						className="grid gap-2 py-4"
						key={[
							source.kind,
							source.title,
							...(source.kind === "campus_document"
								? [source.collectionLabel, source.sectionTitle, source.versionSlug]
								: source.kind === "campus_notice"
									? [source.noticeId, source.sectionTitle]
									: [source.hostname]),
							source.primaryAction.href,
							source.primaryAction.label,
							source.snippet,
							sourceIndex,
						].join(":")}
					>
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div className="flex min-w-0 items-start gap-2">
								<span
									aria-label={`引用 ${source.citationIndexes.join("、")}`}
									className="text-muted-foreground shrink-0 text-sm font-medium"
									role="img"
								>
									{source.citationIndexes.map((index) => `[${index}]`).join(" ")}
								</span>
								<div className="min-w-0">
									<p className="font-medium text-foreground">{source.title}</p>
									{(source.kind === "campus_document" || source.kind === "campus_notice") &&
									source.sectionTitle ? (
										<p className="mt-1 text-muted-foreground text-xs">{source.sectionTitle}</p>
									) : null}
									<p className="mt-1 text-muted-foreground text-xs">
										{source.kind === "web_page"
											? source.hostname
											: source.kind === "campus_notice"
												? `通知 ${source.noticeId}`
												: [source.collectionLabel, formatDocsVersionLabel(source.versionSlug)]
														.filter(Boolean)
														.join(" · ")}
									</p>
								</div>
							</div>
							<SourceAction source={source} />
						</div>
						{source.snippet ? (
							<p className="max-w-3xl text-muted-foreground text-sm leading-6">{source.snippet}</p>
						) : null}
					</li>
				))}
			</ul>
		</section>
	);
}

function formatDocsVersionLabel(versionSlug: string): string {
	return versionSlug.length === 4 ? `${versionSlug} 年版` : `第 ${versionSlug} 版`;
}

function SourceAction({ source }: { source: ChatSourceItem }) {
	const action = source.primaryAction;
	if (!action.href) {
		return action.disabledReason ? (
			<span className="text-muted-foreground text-xs">{action.disabledReason}</span>
		) : null;
	}
	return (
		<a
			className="inline-flex min-h-11 items-center gap-2 font-medium text-info text-sm hover:underline"
			href={action.href}
			rel={action.external ? "noopener noreferrer" : undefined}
			target={action.external ? "_blank" : undefined}
		>
			{action.label}
		</a>
	);
}
