import {
	DINING_SUBMISSION_PHOTO_MAX_INPUT_BYTES,
	type DiningMySubmission,
	DiningSubmissionCreateSchema,
	type DiningSubmissionUpdate,
	DiningSubmissionUpdateSchema,
} from "@campus-agent/dining/domain";
import { Button, Input, Label } from "@campus-agent/ui";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { type FormEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
	createDiningSubmission,
	getMyDiningSubmission,
	updateDiningSubmission,
} from "@/features/dining/submission-api";
import { submissionErrorMessage } from "@/features/dining/submission-error";
import { invalidateDiningSubmissions } from "@/features/dining/submission-queries";
import { ApiRequestError, createIdempotencyKey } from "@/platform/api/client";
import { useCampusSession } from "@/platform/auth/session";

import { useDiningSubmissionExit } from "./dining-submission-exit";

interface Props {
	windowId: string;
	windowName: string;
	submission?: DiningMySubmission;
	onSaved(submission: DiningMySubmission): void;
	onCancel(): void;
}

export function DiningSubmissionForm(props: Props) {
	const session = useCampusSession();
	return (
		<SubmissionForm
			key={`${session.data?.user.id ?? "guest"}:${props.submission?.submissionId ?? props.windowId}`}
			{...props}
		/>
	);
}

function SubmissionForm(props: Props) {
	const session = useCampusSession();
	const client = useQueryClient();
	const { register, requestExit } = useDiningSubmissionExit();
	const saved = useRef(false);
	const id = useId();
	const [current, setCurrent] = useState(props.submission);
	const [name, setName] = useState(
		props.submission && "name" in props.submission ? props.submission.name : "",
	);
	const [price, setPrice] = useState(
		props.submission && "priceText" in props.submission ? (props.submission.priceText ?? "") : "",
	);
	const [photoAction, setPhotoAction] = useState<DiningSubmissionUpdate["photoAction"]>("keep");
	const [photo, setPhoto] = useState<File | null>(null);
	const [preview, setPreview] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<Error | null>(null);
	const [fieldError, setFieldError] = useState<string | null>(null);
	const [photoError, setPhotoError] = useState<string | null>(null);
	const idempotencyKey = useRef<string | null>(null);
	const active = useRef(true);
	const fileInput = useRef<HTMLInputElement | null>(null);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);
	useEffect(() => {
		if (!photo) {
			setPreview(null);
			return;
		}
		const url = URL.createObjectURL(photo);
		setPreview(url);
		return () => URL.revokeObjectURL(url);
	}, [photo]);
	const editable = session.status === "authenticated" && (!current || current.canEdit);
	const disabled = pending || refreshing || !editable;
	const existingPhoto = current && "photo" in current ? current.photo : null;
	const visiblePhoto = photo ? preview : photoAction === "keep" ? existingPhoto?.url : null;
	const conflict = error instanceof ApiRequestError && error.status === 412;
	const baselineName = current && "name" in current ? current.name : "";
	const baselinePrice = current && "priceText" in current ? (current.priceText ?? "") : "";
	const dirty =
		name !== baselineName ||
		price !== baselinePrice ||
		Boolean(photo) ||
		(photoAction === "remove" && Boolean(existingPhoto));
	const exitState = useRef({ dirty: false, pending: false });
	exitState.current = {
		dirty: !saved.current && dirty,
		pending: !saved.current && (pending || refreshing),
	};
	useLayoutEffect(() => register(() => exitState.current), [register]);

	function changed() {
		idempotencyKey.current = null;
		setError(null);
		setFieldError(null);
	}
	function clearPhoto() {
		setPhoto(null);
		setPhotoError(null);
		changed();
		if (fileInput.current) {
			fileInput.current.value = "";
		}
	}
	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (disabled || photoError) {
			return;
		}
		const fields = { name, priceText: price.trim() || null };
		const parsed = current
			? DiningSubmissionUpdateSchema.safeParse({ ...fields, photoAction })
			: DiningSubmissionCreateSchema.safeParse({
					...fields,
					photoAction: photo ? "replace" : "none",
				});
		if (!parsed.success) {
			setFieldError("请填写 1–80 字的菜品名称，价格说明不超过 40 字。");
			return;
		}
		if (current && photoAction === "replace" && !photo) {
			setPhotoError("请选择一张替换照片。");
			return;
		}
		idempotencyKey.current ??= createIdempotencyKey();
		setPending(true);
		setError(null);
		setFieldError(null);
		try {
			const result = current
				? await updateDiningSubmission({
						submissionId: current.submissionId,
						revision: current.revision,
						metadata: DiningSubmissionUpdateSchema.parse(parsed.data),
						photo: photoAction === "replace" ? photo : null,
					})
				: await createDiningSubmission({
						windowId: props.windowId,
						idempotencyKey: idempotencyKey.current,
						metadata: DiningSubmissionCreateSchema.parse(parsed.data),
						photo,
					});
			if (active.current) {
				saved.current = true;
				exitState.current = { dirty: false, pending: false };
				props.onSaved(result.submission);
			}
			await invalidateDiningSubmissions(client);
		} catch (caught) {
			if (active.current) {
				setError(caught instanceof Error ? caught : new Error("投稿未保存，请重试。"));
			}
		} finally {
			if (active.current) {
				setPending(false);
			}
		}
	}
	async function refreshCurrent() {
		if (!current) {
			return;
		}
		setRefreshing(true);
		try {
			const result = await getMyDiningSubmission(current.submissionId);
			if (!active.current) {
				return;
			}
			setCurrent(result.submission);
			setName("name" in result.submission ? result.submission.name : "");
			setPrice("priceText" in result.submission ? (result.submission.priceText ?? "") : "");
			setPhotoAction("keep");
			clearPhoto();
		} catch (caught) {
			if (active.current) {
				setError(caught instanceof Error ? caught : new Error("暂时无法读取当前投稿。"));
			}
		} finally {
			if (active.current) {
				setRefreshing(false);
			}
		}
	}
	return (
		<form
			aria-label={current ? "编辑用户投稿" : "新增用户投稿"}
			className="min-w-0 space-y-5"
			onSubmit={submit}
		>
			<div className="space-y-2 text-sm text-muted-foreground">
				<p>所属窗口：{props.windowName}</p>
				<p>投稿会公开显示你的账号名称。请确认文字和照片适合公开分享。</p>
				{current ? null : <p>每天最多新增三条投稿，删除后仍计入当天数量。</p>}
				{current?.status === "hidden" ? <p>此投稿已隐藏，保存修改后仍不会公开。</p> : null}
				{current && !current.canEdit ? <p role="status">此投稿当前不能编辑。</p> : null}
				{session.status === "authenticated" ? null : <p role="status">请先登录后投稿。</p>}
			</div>
			<div className="space-y-2">
				<Label htmlFor={`${id}-name`}>菜品名称</Label>
				<Input
					aria-describedby={fieldError ? `${id}-fields-error` : undefined}
					disabled={disabled}
					id={`${id}-name`}
					maxLength={80}
					onChange={(event) => {
						setName(event.target.value);
						changed();
					}}
					required
					value={name}
				/>
			</div>
			<div className="space-y-2">
				<Label htmlFor={`${id}-price`}>价格说明（选填）</Label>
				<Input
					aria-describedby={fieldError ? `${id}-fields-error` : undefined}
					disabled={disabled}
					id={`${id}-price`}
					maxLength={40}
					onChange={(event) => {
						setPrice(event.target.value);
						changed();
					}}
					placeholder="例如 12 元 / 份"
					value={price}
				/>
			</div>
			{fieldError ? (
				<p className="text-sm text-destructive" id={`${id}-fields-error`} role="alert">
					{fieldError}
				</p>
			) : null}
			{current ? (
				<fieldset disabled={disabled}>
					<legend className="text-sm font-medium">照片操作</legend>
					<div className="flex flex-wrap gap-x-4">
						{(
							[
								{ value: "keep", label: "保持照片不变" },
								{ value: "remove", label: "移除照片" },
								{ value: "replace", label: "替换照片" },
							] as const
						).map((option) => (
							<label className="flex min-h-11 items-center gap-2 text-sm" key={option.value}>
								<input
									checked={photoAction === option.value}
									name={`${id}-photo-action`}
									onChange={() => {
										setPhotoAction(option.value);
										clearPhoto();
									}}
									type="radio"
									value={option.value}
								/>
								{option.label}
							</label>
						))}
					</div>
				</fieldset>
			) : null}
			{!current || photoAction === "replace" ? (
				<div className="space-y-2">
					<Label htmlFor={`${id}-photo`}>{current ? "替换照片" : "照片（选填）"}</Label>
					<Input
						accept="image/jpeg,image/png,image/webp"
						aria-describedby={`${id}-photo-help${photoError ? ` ${id}-photo-error` : ""}`}
						disabled={disabled}
						id={`${id}-photo`}
						onChange={(event) => {
							const file = event.target.files?.[0] ?? null;
							setPhoto(file);
							setPhotoError(
								file && (file.size === 0 || file.size > DINING_SUBMISSION_PHOTO_MAX_INPUT_BYTES)
									? "请选择非空且不超过 10 MiB 的照片。"
									: null,
							);
							changed();
						}}
						ref={fileInput}
						type="file"
					/>
					<p className="text-xs text-muted-foreground" id={`${id}-photo-help`}>
						仅一张 JPEG、PNG 或 WebP；不超过 10 MiB，宽高均不超过 4096
						像素，不支持动画。照片将在提交后进行检查。
					</p>
					{photo ? (
						<Button
							disabled={disabled}
							onClick={clearPhoto}
							size="sm"
							type="button"
							variant="outline"
						>
							清除所选照片
						</Button>
					) : null}
				</div>
			) : null}
			{photoError ? (
				<p className="text-sm text-destructive" id={`${id}-photo-error`} role="alert">
					{photoError}
				</p>
			) : null}
			{visiblePhoto ? (
				<img
					alt="投稿照片预览"
					className="max-h-64 w-full rounded-md object-contain"
					src={visiblePhoto}
				/>
			) : null}
			{error ? (
				<div className="space-y-2">
					<p className="text-sm text-destructive" role="alert">
						{conflict
							? "投稿已发生变化，请重新读取当前内容后再编辑。"
							: submissionErrorMessage(error)}
					</p>
					{error instanceof ApiRequestError && error.status === 401 ? (
						<Button type="button" variant="outline" onClick={() => void session.refresh()}>
							重新确认登录状态
						</Button>
					) : null}
					{conflict ? (
						<>
							<p className="text-xs text-muted-foreground">重新读取会替换当前未保存的修改。</p>
							<Button
								disabled={refreshing}
								onClick={() => void refreshCurrent()}
								type="button"
								variant="outline"
							>
								{refreshing ? "正在读取" : "重新读取当前投稿"}
							</Button>
						</>
					) : null}
				</div>
			) : null}
			<div className="flex flex-wrap justify-end gap-3">
				<Button
					disabled={pending}
					onClick={() => requestExit(props.onCancel)}
					type="button"
					variant="outline"
				>
					取消
				</Button>
				<Button
					disabled={disabled || !name.trim() || Boolean(photoError) || conflict}
					type="submit"
				>
					{pending ? <LoaderCircle className="animate-spin" /> : null}
					{pending ? "正在保存" : current ? "保存修改" : "发布投稿"}
				</Button>
			</div>
		</form>
	);
}
