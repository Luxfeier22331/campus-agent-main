import { ArrowRight, BookOpen, ExternalLink, FileText, MessageSquareText } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
	HUB_NAVIGATION_ENTRIES,
	type HubLauncherEntry,
	resolveHubEntryHref,
} from "../platform/launcher/manifest";

const entryIcons = {
	chat: MessageSquareText,
	docs: FileText,
	"muc-wiki": BookOpen,
} as const;

const entryActions = {
	chat: "开始提问",
	docs: "浏览文档",
	"muc-wiki": "访问主站",
} as const;

export function LauncherPage() {
	return (
		<section className="mx-auto w-full max-w-6xl px-5 py-14 lg:px-8 lg:py-16">
			<div className="mb-14 text-center">
				<h1 className="text-balance text-4xl font-bold tracking-normal text-foreground sm:text-5xl">
					MUC Wiki Hub
				</h1>
				<p className="mt-4 text-lg text-muted-foreground">校园公共应用统一入口。</p>
			</div>
			<div className="grid gap-6 lg:grid-cols-3">
				{HUB_NAVIGATION_ENTRIES.map((entry) => (
					<HubEntryCard entry={entry} key={entry.slug} />
				))}
			</div>
		</section>
	);
}

function HubEntryCard({ entry }: { entry: HubLauncherEntry }) {
	const Icon = entryIcons[entry.slug];
	const action = entryActions[entry.slug];
	const isExternalTarget = entry.targetKind === "external";
	const href = resolveHubEntryHref(entry);

	const card = (
		<Card className="group flex min-h-52 flex-col justify-between rounded-lg border-border bg-card transition-colors hover:border-primary/40">
			<CardContent className="flex h-full flex-col p-6">
				<span className="mb-6 grid size-11 place-items-center rounded-lg bg-accent text-primary">
					<Icon aria-hidden="true" className="size-6" />
				</span>
				<h2 className="text-2xl font-semibold tracking-normal text-foreground">{entry.label}</h2>
				<p className="mt-3 flex-1 text-base leading-7 text-muted-foreground">{entry.description}</p>
				<span
					className={cn(
						"mt-8 inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors",
						isExternalTarget
							? "border-input bg-card text-primary group-hover:bg-accent"
							: "border-primary bg-primary text-primary-foreground group-hover:bg-primary/90",
					)}
				>
					{action}
					{isExternalTarget ? (
						<ExternalLink aria-hidden="true" className="size-4" />
					) : (
						<ArrowRight aria-hidden="true" className="size-4" />
					)}
				</span>
			</CardContent>
		</Card>
	);

	if (isExternalTarget) {
		return (
			<a
				className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
				href={href}
				rel="noreferrer"
				target="_blank"
			>
				{card}
			</a>
		);
	}

	return (
		<a
			className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
			href={href}
		>
			{card}
		</a>
	);
}
