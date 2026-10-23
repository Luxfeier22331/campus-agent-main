import { Card, CardContent, CardHeader, CardTitle, Separator } from "@campus-agent/ui";
import { useState } from "react";
import { FeedbackForm, type FeedbackInitialState } from "@/components/feedback/feedback-form";
import { submitFeedback } from "@/features/feedback/api";
import { useCampusSession } from "@/platform/auth/session";

const feedbackSourceLabels: Record<string, string> = {
	dining: "食堂地图",
	map: "校园地图",
};

export function FeedbackPage({
	initialState = "empty",
	routeContext,
	submit = submitFeedback,
}: {
	initialState?: FeedbackInitialState;
	routeContext?: string;
	submit?: typeof submitFeedback;
} = {}) {
	const [initialRouteContext] = useState(() => routeContext ?? getInitialFeedbackRouteContext());
	const session = useCampusSession();
	const sessionContact = session.status === "authenticated" ? session.data?.user.email : null;
	const sourceLabel = formatFeedbackSource(initialRouteContext);

	return (
		<section className="mx-auto max-w-[var(--layout-page-form-width)] px-4 py-6 pb-24 lg:px-6">
			<h1 className="mt-1 ui-page-title">反馈</h1>
			<Separator className="mt-5" />
			<Card className="mt-5">
				<CardHeader>
					<CardTitle asChild>
						<h2>提交反馈</h2>
					</CardTitle>
				</CardHeader>
				<CardContent>
					<FeedbackForm
						initialState={initialState}
						routeContext={initialRouteContext}
						sessionContact={sessionContact}
						sourceLabel={sourceLabel}
						submit={submit}
					/>
				</CardContent>
			</Card>
		</section>
	);
}

function formatFeedbackSource(routeContext: string): string {
	try {
		const source = new URL(routeContext, "https://campus.invalid").searchParams.get("source");
		return (source && feedbackSourceLabels[source]) || routeContext;
	} catch {
		return routeContext;
	}
}

function getInitialFeedbackRouteContext(): string {
	if (typeof window === "undefined") {
		return "/";
	}
	return `${window.location.pathname}${window.location.search}${window.location.hash}` || "/";
}
