import {
	Alert,
	AlertDescription,
	AlertTitle,
	Button,
	Checkbox,
	Input,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
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

const feedbackSchema = z.object({
	body: z.string().trim().min(1, "请填写问题描述。"),
	category: z.enum(feedbackCategoryValues),
	contact: z.string(),
	routeContext: z.string().min(1, "请填写反馈来源。"),
});

type FeedbackFormValues = z.infer<typeof feedbackSchema>;

export type FeedbackInitialState = "empty" | "invalid" | "submitting" | "error" | "submitted";

export interface FeedbackFormProps {
	defaultCategory?: FeedbackCategory;
	initialState?: FeedbackInitialState;
	onDone?: (() => void) | undefined;
	routeContext: string;
	/** 登录用户的账号邮箱；传入时显示"匿名提交"选项而不是手填联系方式。 */
	sessionContact?: string | null | undefined;
	sourceLabel: string;
	submit?: typeof submitFeedback;
}

export function FeedbackForm({
	defaultCategory = "content_issue",
	initialState,
	onDone,
	routeContext,
	sessionContact = null,
	sourceLabel,
	submit = submitFeedback,
}: FeedbackFormProps) {
	const [error, setError] = useState<string | null>(
		initialState === "error" ? "反馈暂时没有提交成功。" : null,
	);
	const [submitted, setSubmitted] = useState(initialState === "submitted");
	const [submitting, setSubmitting] = useState(initialState === "submitting");
	// Signed-in users start anonymous by default; opting in reveals a contact
	// field prefilled with the campus email, which stays editable.
	const [anonymous, setAnonymous] = useState(true);
	const form = useForm<FeedbackFormValues>({
		defaultValues: {
			body: "",
			category: defaultCategory,
			contact: sessionContact ?? "",
			routeContext,
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
				contact: sessionContact
					? anonymous
						? null
						: values.contact.trim() || null
					: values.contact.trim() || null,
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
					<Label htmlFor="feedback-body">问题描述</Label>
					<Textarea
						{...form.register("body")}
						aria-describedby={form.formState.errors.body ? "feedback-body-error" : undefined}
						aria-invalid={form.formState.errors.body ? "true" : undefined}
						className="min-h-32"
						id="feedback-body"
						placeholder="请描述遇到的问题"
					/>
					{form.formState.errors.body ? (
						<p className="text-destructive text-xs" id="feedback-body-error" role="alert">
							{form.formState.errors.body.message}
						</p>
					) : null}
				</div>
				{sessionContact ? (
					<div className="grid gap-2">
						<label
							className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-[var(--sys-text-muted)]"
							htmlFor="feedback-anonymous"
						>
							<Checkbox
								checked={anonymous}
								id="feedback-anonymous"
								onCheckedChange={(checked) => setAnonymous(checked === true)}
							/>
							匿名提交
						</label>
						{anonymous ? (
							<p className="text-xs text-[var(--sys-text-subtle)]">不会附带你的账号联系方式。</p>
						) : (
							<div className="grid gap-2">
								<Label htmlFor="feedback-contact">
									联系方式 <span className="text-xs text-[var(--sys-text-subtle)]">(可选)</span>
								</Label>
								<Input
									{...form.register("contact")}
									autoComplete="email"
									className="min-h-11"
									id="feedback-contact"
									placeholder="邮箱或其他联系方式"
									type="text"
								/>
								<p className="text-xs text-[var(--sys-text-subtle)]">
									默认填入校园邮箱，仅作为联系方式；可改成其他邮箱或留空。
								</p>
							</div>
						)}
					</div>
				) : (
					<div className="grid gap-2">
						<Label htmlFor="feedback-contact">
							联系方式 <span className="text-xs text-[var(--sys-text-subtle)]">(可选)</span>
						</Label>
						<Input
							{...form.register("contact")}
							autoComplete="email"
							className="min-h-11"
							id="feedback-contact"
							placeholder="邮箱或其他联系方式"
							type="text"
						/>
					</div>
				)}
				<div className="grid gap-2">
					<Label htmlFor="feedback-source">反馈来源</Label>
					<Input
						className="min-h-11"
						id="feedback-source"
						readOnly
						type="text"
						value={sourceLabel}
					/>
				</div>
				<LayoutGroup>
					{submitted ? (
						<motion.div key="submitted" {...stateSwap}>
							<Alert tone="success">
								<AlertTitle>反馈已提交。</AlertTitle>
								<AlertDescription>我们会尽快处理你的反馈。</AlertDescription>
							</Alert>
							{onDone ? (
								<Button className="mt-3 min-h-11" onClick={onDone} type="button">
									关闭
								</Button>
							) : null}
						</motion.div>
					) : null}
					{error ? (
						<motion.div key="error" {...stateSwap}>
							<Alert tone="danger">
								<AlertTitle>提交失败</AlertTitle>
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						</motion.div>
					) : null}
				</LayoutGroup>
				{submitted ? null : (
					<Button className="min-h-11 w-full" disabled={submitting} type="submit">
						{submitting ? "正在提交…" : "提交反馈"}
					</Button>
				)}
			</motion.form>
		</CampusMotionProvider>
	);
}
