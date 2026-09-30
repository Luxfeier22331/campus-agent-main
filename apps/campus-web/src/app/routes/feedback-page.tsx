import {
	Alert,
	Button,
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	Field,
	Input,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Separator,
	Textarea,
} from "@campus-agent/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { LayoutGroup, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { CampusMotionProvider, stateSwap } from "@/components/ui/motion";
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

const feedbackSourceLabels: Record<string, string> = {
	dining: "食堂地图",
	legal: "服务协议与隐私政策",
	map: "校园地图",
};

const feedbackSchema = z.object({
	body: z.string().trim().min(1, "请填写问题描述。"),
	category: z.enum(feedbackCategoryValues),
	contact: z.string(),
	routeContext: z.string().min(1, "请填写反馈来源。"),
});

type FeedbackFormValues = z.infer<typeof feedbackSchema>;

export type FeedbackInitialState = "empty" | "invalid" | "submitting" | "error" | "submitted";

export function FeedbackPage({
	initialState = "empty",
	routeContext,
	submit = submitFeedback,
}: {
	initialState?: FeedbackInitialState;
	routeContext?: string;
	submit?: typeof submitFeedback;
} = {}) {
	const [error, setError] = useState<string | null>(
		initialState === "error" ? "反馈暂时没有提交成功。" : null,
	);
	const [initialRouteContext] = useState(() => routeContext ?? getInitialFeedbackRouteContext());
	const [submitted, setSubmitted] = useState(initialState === "submitted");
	const [submitting, setSubmitting] = useState(initialState === "submitting");
	const form = useForm<FeedbackFormValues>({
		defaultValues: {
			body: "",
			category: "content_issue",
			contact: "",
			routeContext: initialRouteContext,
		},
		resolver: zodResolver(feedbackSchema),
	});
	async function handleSubmit(values: FeedbackFormValues) {
		setSubmitting(true);
		setError(null);
		setSubmitted(false);
		try {
			await submit({
				body: values.body,
				category: values.category,
				contact: values.contact.trim() || null,
				routeContext: values.routeContext,
			});
			setSubmitted(true);
			form.reset({ ...values, body: "" });
		} catch {
			setError("反馈暂时没有提交成功。");
		} finally {
			setSubmitting(false);
		}
	}

	useEffect(() => {
		if (initialState === "invalid") {
			form.setError("body", { message: "请填写问题描述。" });
		}
	}, [form, initialState]);

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
					<CampusMotionProvider>
						<motion.form
							className="space-y-5"
							layout
							noValidate
							onSubmit={form.handleSubmit(handleSubmit)}
						>
							<Controller
								control={form.control}
								name="category"
								render={({ field }) => (
									<div className="grid gap-2">
										<Label htmlFor="feedback-category">问题类型</Label>
										<Select
											items={categories}
											name="category"
											onValueChange={field.onChange}
											value={field.value}
										>
											<SelectTrigger className="min-h-11" id="feedback-category">
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
									</div>
								)}
							/>
							<div className="grid gap-2">
								<Label htmlFor="feedback-route-context">反馈来源</Label>
								<output
									className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm leading-6 text-[var(--sys-text-muted)]"
									id="feedback-route-context"
								>
									{formatFeedbackSource(initialRouteContext)}
								</output>
								<input type="hidden" {...form.register("routeContext")} />
							</div>
							<div className="grid gap-2">
								<Field label={<> 问题描述 </>} id="feedback-body">
									<Textarea
										aria-describedby={
											form.formState.errors.body ? "feedback-body-error" : undefined
										}
										aria-invalid={form.formState.errors.body ? "true" : undefined}
										id="feedback-body"
										required
										{...form.register("body")}
									/>
								</Field>
								{form.formState.errors.body ? (
									<p className="text-destructive text-xs" id="feedback-body-error" role="alert">
										{form.formState.errors.body.message ?? "请填写问题描述。"}
									</p>
								) : null}
							</div>
							<div className="grid gap-2">
								<Field label={<> 联系方式（可选） </>} id="feedback-contact">
									<Input
										className="min-h-11"
										id="feedback-contact"
										placeholder="邮箱或其他联系方式"
										{...form.register("contact")}
									/>
								</Field>
							</div>
							<LayoutGroup>
								<motion.div aria-live="polite" className="grid gap-2" layout>
									{error ? (
										<motion.div key="feedback-error" layout {...stateSwap}>
											<Alert tone="danger">{error}</Alert>
										</motion.div>
									) : null}
									{submitted ? (
										<motion.div key="feedback-received" layout {...stateSwap}>
											<Alert tone="success">反馈已提交。</Alert>
										</motion.div>
									) : null}
								</motion.div>
							</LayoutGroup>
							<Button disabled={submitting} size="lg" type="submit">
								{submitting ? "提交中" : "提交反馈"}
							</Button>
						</motion.form>
					</CampusMotionProvider>
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
