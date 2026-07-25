import {
	Alert,
	Button,
	Card,
	CardContent,
	CardHeader,
	CardTitle,
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
import { useState } from "react";
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

const feedbackSchema = z.object({
	body: z.string().trim().min(1, "请填写问题描述。"),
	category: z.enum(feedbackCategoryValues),
	contact: z.string(),
	routeContext: z.string().min(1, "请填写当前页面。"),
});

type FeedbackFormValues = z.infer<typeof feedbackSchema>;

export function FeedbackPage() {
	const [error, setError] = useState<string | null>(null);
	const [submitted, setSubmitted] = useState(false);
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
		setSubmitted(false);
		try {
			await submitFeedback({
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

	return (
		<section className="mx-auto max-w-[var(--layout-page-form-width)] px-4 py-6 pb-24 lg:px-6">
			<h1 className="mt-1 text-2xl font-semibold tracking-normal text-[var(--sys-text-strong)] md:text-3xl">
				反馈
			</h1>
			<Separator className="mt-5" />
			<Card className="mt-5">
				<CardHeader>
					<CardTitle asChild>
						<h2>提交反馈</h2>
					</CardTitle>
				</CardHeader>
				<CardContent>
					<CampusMotionProvider>
						<motion.form className="space-y-5" layout>
							<Controller
								control={form.control}
								name="category"
								render={({ field }) => (
									<div className="grid gap-2">
										<Label htmlFor="feedback-category">问题类型</Label>
										<Select onValueChange={field.onChange} value={field.value}>
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
								<Label htmlFor="feedback-route-context">当前页面</Label>
								<output
									className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm leading-6 text-[var(--sys-text-muted)]"
									id="feedback-route-context"
								>
									{form.getValues("routeContext")}
								</output>
								<input type="hidden" {...form.register("routeContext")} />
							</div>
							<div className="grid gap-2">
								<Label htmlFor="feedback-body">问题描述</Label>
								<Textarea id="feedback-body" {...form.register("body")} />
								{form.formState.errors.body ? (
									<p className="text-destructive text-xs" role="alert">
										{form.formState.errors.body.message ?? "请填写问题描述。"}
									</p>
								) : null}
							</div>
							<div className="grid gap-2">
								<Label htmlFor="feedback-contact">联系方式（可选）</Label>
								<Input
									className="min-h-11"
									id="feedback-contact"
									placeholder="邮箱或其他联系方式"
									{...form.register("contact")}
								/>
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
											<Alert>反馈已提交。</Alert>
										</motion.div>
									) : null}
								</motion.div>
							</LayoutGroup>
							<Button
								disabled={submitting || !body.trim()}
								onClick={form.handleSubmit(handleSubmit)}
								size="lg"
								type="button"
							>
								{submitting ? "提交中" : "提交反馈"}
							</Button>
						</motion.form>
					</CampusMotionProvider>
				</CardContent>
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
