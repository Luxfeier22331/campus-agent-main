import { type FormEvent, useState } from "react";

import { ErrorPanel } from "@/components/shell/state-panels";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { submitFeedback } from "@/features/feedback/api";
import type { FeedbackCategory } from "@/features/feedback/model";

const categories: Array<{ label: string; value: FeedbackCategory }> = [
	{ label: "内容问题", value: "content_issue" },
	{ label: "地图问题", value: "map_issue" },
	{ label: "食堂问题", value: "dining_issue" },
	{ label: "体验问题", value: "experience_issue" },
	{ label: "其他", value: "other" },
];

export function FeedbackPage() {
	const [category, setCategory] = useState<FeedbackCategory>("content_issue");
	const [body, setBody] = useState("");
	const [contact, setContact] = useState("");
	const [routeContext, setRouteContext] = useState(() => getCurrentRouteContext());
	const [error, setError] = useState<string | null>(null);
	const [receivedId, setReceivedId] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setSubmitting(true);
		setError(null);
		setReceivedId(null);
		try {
			const response = await submitFeedback({
				body,
				category,
				contact: contact.trim() || null,
				routeContext,
			});
			setReceivedId(response.feedback.feedbackId);
			setBody("");
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "反馈提交失败。");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<section className="mx-auto max-w-3xl px-5 py-10 pb-24">
			<p className="text-sm font-medium text-primary">反馈</p>
			<h1 className="mt-2 text-3xl font-semibold tracking-normal text-[var(--sys-text-strong)]">
				提交问题
			</h1>
			<Card className="mt-6 p-5 md:p-6">
				<form className="space-y-5" onSubmit={handleSubmit}>
					<label className="block" htmlFor="feedback-category">
						<span className="text-sm font-medium text-[var(--sys-text-strong)]">问题类型</span>
						<select
							className="mt-2 min-h-11 w-full rounded-lg border border-input bg-white px-3 text-sm"
							id="feedback-category"
							onChange={(event) => setCategory(event.target.value as FeedbackCategory)}
							value={category}
						>
							{categories.map((item) => (
								<option key={item.value} value={item.value}>
									{item.label}
								</option>
							))}
						</select>
					</label>
					<label className="block" htmlFor="feedback-route-context">
						<span className="text-sm font-medium text-[var(--sys-text-strong)]">相关页面</span>
						<Input
							id="feedback-route-context"
							onChange={(event) => setRouteContext(event.target.value)}
							value={routeContext}
						/>
					</label>
					<label className="block" htmlFor="feedback-body">
						<span className="text-sm font-medium text-[var(--sys-text-strong)]">问题描述</span>
						<Textarea
							id="feedback-body"
							onChange={(event) => setBody(event.target.value)}
							required
							value={body}
						/>
					</label>
					<label className="block" htmlFor="feedback-contact">
						<span className="text-sm font-medium text-[var(--sys-text-strong)]">
							联系方式（可选）
						</span>
						<Input
							id="feedback-contact"
							onChange={(event) => setContact(event.target.value)}
							placeholder="邮箱或其他联系方式"
							value={contact}
						/>
					</label>
					{error ? <ErrorPanel message={error} /> : null}
					{receivedId ? (
						<p className="rounded-lg bg-[rgba(0,112,62,0.08)] px-4 py-3 text-sm text-[var(--sys-status-success)]">
							已收到：{receivedId}
						</p>
					) : null}
					<Button disabled={submitting || !body.trim()} type="submit">
						{submitting ? "提交中" : "提交反馈"}
					</Button>
				</form>
			</Card>
		</section>
	);
}

function getCurrentRouteContext(): string {
	if (typeof window === "undefined") {
		return "/";
	}
	return `${window.location.pathname}${window.location.search}${window.location.hash}` || "/";
}
