import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { ErrorPanel } from "@/components/shell/state-panels";
import { SupportSurfaceShell } from "@/components/shell/support-surface-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { submitFeedback } from "@/features/feedback/api";
import type { FeedbackCategory } from "@/features/feedback/model";

const feedbackCategoryValues = [
	"content_issue",
	"map_issue",
	"dining_issue",
	"experience_issue",
	"other",
] as const;

const categories: Array<{ label: string; value: FeedbackCategory }> = [
	{ label: "内容问题", value: "content_issue" },
	{ label: "地图问题", value: "map_issue" },
	{ label: "食堂问题", value: "dining_issue" },
	{ label: "体验问题", value: "experience_issue" },
	{ label: "其他", value: "other" },
];

const feedbackSchema = z.object({
	body: z.string().trim().min(1, "请填写问题描述。"),
	category: z.enum(feedbackCategoryValues),
	contact: z.string(),
	routeContext: z.string().min(1, "请填写当前页面。"),
});

type FeedbackFormValues = z.infer<typeof feedbackSchema>;

export function FeedbackPage() {
	const [error, setError] = useState<string | null>(null);
	const [receivedId, setReceivedId] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const form = useForm<FeedbackFormValues>({
		defaultValues: {
			body: "",
			category: "content_issue",
			contact: "",
			routeContext: getCurrentRouteContext(),
		},
		resolver: zodResolver(feedbackSchema),
	});
	const body = form.watch("body");

	async function handleSubmit(values: FeedbackFormValues) {
		setSubmitting(true);
		setError(null);
		setReceivedId(null);
		try {
			const response = await submitFeedback({
				body: values.body,
				category: values.category,
				contact: values.contact.trim() || null,
				routeContext: values.routeContext,
			});
			setReceivedId(response.feedback.feedbackId);
			form.reset({ ...values, body: "" });
		} catch {
			setError("反馈暂时没有提交成功。");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<SupportSurfaceShell className="max-w-4xl" title="反馈">
			<Card>
				<CardHeader>
					<CardTitle>提交反馈</CardTitle>
				</CardHeader>
				<CardContent>
					<form className="space-y-5">
						<Controller
							control={form.control}
							name="category"
							render={({ field }) => (
								<label className="block" htmlFor="feedback-category">
									<span className="text-sm font-medium text-[var(--sys-text-strong)]">
										问题类型
									</span>
									<Select onValueChange={field.onChange} value={field.value}>
										<SelectTrigger className="mt-2" id="feedback-category">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{categories.map((item) => (
												<SelectItem key={item.value} value={item.value}>
													{item.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</label>
							)}
						/>
						<label className="block" htmlFor="feedback-route-context">
							<span className="text-sm font-medium text-[var(--sys-text-strong)]">当前页面</span>
							<Input id="feedback-route-context" {...form.register("routeContext")} />
						</label>
						<label className="block" htmlFor="feedback-body">
							<span className="text-sm font-medium text-[var(--sys-text-strong)]">问题描述</span>
							<Textarea id="feedback-body" {...form.register("body")} />
						</label>
						<label className="block" htmlFor="feedback-contact">
							<span className="text-sm font-medium text-[var(--sys-text-strong)]">
								联系方式（可选）
							</span>
							<Input
								id="feedback-contact"
								placeholder="邮箱或其他联系方式"
								{...form.register("contact")}
							/>
						</label>
						{error ? <ErrorPanel message={error} /> : null}
						{form.formState.errors.body ? (
							<ErrorPanel message={form.formState.errors.body.message ?? "请填写问题描述。"} />
						) : null}
						{receivedId ? (
							<p className="rounded-lg bg-[rgba(0,112,62,0.08)] px-4 py-3 text-sm text-[var(--sys-status-success)]">
								已收到：{receivedId}
							</p>
						) : null}
						<Button
							disabled={submitting || !body.trim()}
							onClick={form.handleSubmit(handleSubmit)}
							type="button"
						>
							{submitting ? "提交中" : "提交反馈"}
						</Button>
					</form>
				</CardContent>
			</Card>
		</SupportSurfaceShell>
	);
}

function getCurrentRouteContext(): string {
	if (typeof window === "undefined") {
		return "/";
	}
	return `${window.location.pathname}${window.location.search}${window.location.hash}` || "/";
}
