import { ExternalLink, MapPin } from "lucide-react";

import { Card } from "@/components/ui/card";
import type { ChatMessage, ChatStructuredPart } from "@/features/conversation/model";
import { cn } from "@/lib/utils";

export function MessageList({ messages }: { messages: ChatMessage[] }) {
	return (
		<div className="space-y-6">
			{messages.map((message) => (
				<article
					className={cn(
						"rounded-2xl px-5 py-4",
						message.role === "user"
							? "ml-auto max-w-[80%] bg-[var(--chat-message-user-bg)]"
							: "max-w-full bg-[var(--chat-message-answer-bg)]",
					)}
					key={message.id}
				>
					<p className="whitespace-pre-wrap text-[15px] leading-7 text-[var(--sys-text-default)]">
						{message.text}
					</p>
					{message.role === "assistant" ? <StructuredParts message={message} /> : null}
				</article>
			))}
		</div>
	);
}

function StructuredParts({ message }: { message: ChatMessage }) {
	const parts = message.structuredParts ?? [];
	if (parts.length === 0) {
		return null;
	}

	return (
		<div className="mt-4 space-y-3">
			{parts.map((part) => {
				if (part.type === "source_items") {
					return (
						<div className="grid gap-2 md:grid-cols-2" key={getStructuredPartKey(message.id, part)}>
							{part.sourceItems.slice(0, 4).map((source) => (
								<Card className="p-3" key={`${source.title}-${source.sectionTitle}`}>
									<p className="text-sm font-medium text-[var(--sys-text-strong)]">
										{source.title}
									</p>
									<p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--sys-text-muted)]">
										{source.snippet ?? source.sectionTitle}
									</p>
									{source.primaryAction.href ? (
										<a
											className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary"
											href={source.primaryAction.href}
										>
											{source.primaryAction.label}
											<ExternalLink aria-hidden="true" className="size-3" />
										</a>
									) : null}
								</Card>
							))}
						</div>
					);
				}
				return (
					<Card className="flex items-start gap-3 p-3" key={getStructuredPartKey(message.id, part)}>
						<span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--sys-brand-interactive-subtle)] text-primary">
							<MapPin aria-hidden="true" className="size-4" />
						</span>
						<div>
							<p className="text-sm font-medium text-[var(--sys-text-strong)]">
								{part.placeCard.displayName}
							</p>
							<p className="mt-1 text-xs leading-5 text-[var(--sys-text-muted)]">
								{part.placeCard.locationDescription}
							</p>
						</div>
					</Card>
				);
			})}
		</div>
	);
}

function getStructuredPartKey(messageId: string, part: ChatStructuredPart): string {
	if (part.type === "source_items") {
		const sourceKeys = part.sourceItems
			.slice(0, 4)
			.map((source) => `${source.title}:${source.sectionTitle}:${source.primaryAction.href ?? ""}`)
			.join("|");
		return `${messageId}:sources:${sourceKeys}`;
	}
	return `${messageId}:place:${part.placeCard.placeId}`;
}
