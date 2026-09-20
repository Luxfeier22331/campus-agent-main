import {
	Button,
	ConfirmDialog,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Field,
	Input,
	NativeSelect,
	Textarea,
} from "@campus-agent/ui";
import type { CampusGroupSection } from "campus-contracts/campus-groups";
import { useState } from "react";
import type { GroupEditorState, PendingRemoval, SectionEditorState } from "./groups-page-model";
import { InlineError } from "./ops-display";

export function SectionEditor({
	error,
	onCancel,
	onSave,
	pending,
	state,
}: {
	error: unknown;
	onCancel: () => void;
	onSave: (section: CampusGroupSection) => void;
	pending: boolean;
	state: SectionEditorState;
}) {
	const [name, setName] = useState(state.section.name);
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!(open || pending)) {
					onCancel();
				}
			}}
			open
		>
			<DialogContent className="max-w-lg" showCloseButton={!pending}>
				<DialogHeader>
					<DialogTitle>{state.kind === "add" ? "新增分组" : "重命名分组"}</DialogTitle>
				</DialogHeader>
				<form
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						onSave({ ...state.section, name: name.trim() });
					}}
				>
					<Field label="分组名称">
						<Input
							autoFocus
							className="min-h-11"
							onChange={(event) => setName(event.target.value)}
							required
							value={name}
						/>
					</Field>
					{error ? <InlineError error={error} title="保存失败" /> : null}
					<DialogFooter>
						<Button disabled={pending} onClick={onCancel} variant="ghost">
							取消
						</Button>
						<Button disabled={pending} type="submit">
							保存
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function GroupEditor({
	error,
	onCancel,
	onSave,
	pending,
	sections,
	state,
}: {
	error: unknown;
	onCancel: () => void;
	onSave: (state: GroupEditorState) => void;
	pending: boolean;
	sections: CampusGroupSection[];
	state: GroupEditorState;
}) {
	const [form, setForm] = useState(state);
	const [tagsInput, setTagsInput] = useState(state.group.tags.join("，"));
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!(open || pending)) {
					onCancel();
				}
			}}
			open
		>
			<DialogContent
				className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto"
				showCloseButton={!pending}
			>
				<DialogHeader>
					<DialogTitle>{state.originalSectionId ? "编辑同好群" : "新增同好群"}</DialogTitle>
				</DialogHeader>
				<form
					className="grid gap-4 sm:grid-cols-2"
					onSubmit={(event) => {
						event.preventDefault();
						onSave({
							...form,
							group: {
								...form.group,
								name: form.group.name.trim(),
								qqGroupNumber: form.group.qqGroupNumber?.trim() || null,
								summary: form.group.summary.trim(),
								tags: tagsInput
									.split(/[,，]/)
									.map((tag) => tag.trim())
									.filter(Boolean),
							},
						});
					}}
				>
					<Field label="群名">
						<Input
							autoFocus
							className="min-h-11"
							onChange={(event) =>
								setForm({ ...form, group: { ...form.group, name: event.target.value } })
							}
							required
							value={form.group.name}
						/>
					</Field>
					<Field label="分组">
						<NativeSelect
							className="min-h-11"
							onChange={(event) => setForm({ ...form, sectionId: event.target.value })}
							value={form.sectionId}
						>
							{sections.map((section) => (
								<option key={section.id} value={section.id}>
									{section.name}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field label="QQ 群号">
						<Input
							className="min-h-11"
							inputMode="numeric"
							onChange={(event) =>
								setForm({
									...form,
									group: { ...form.group, qqGroupNumber: event.target.value || null },
								})
							}
							pattern="[0-9]{5,12}"
							value={form.group.qqGroupNumber ?? ""}
						/>
					</Field>
					<Field label="标签（用逗号分隔）">
						<Input
							className="min-h-11"
							onChange={(event) => setTagsInput(event.target.value)}
							value={tagsInput}
						/>
					</Field>
					<Field className="sm:col-span-2" label="说明">
						<Textarea
							className="min-h-24"
							onChange={(event) =>
								setForm({ ...form, group: { ...form.group, summary: event.target.value } })
							}
							rows={3}
							value={form.group.summary}
						/>
					</Field>
					<Field
						className="sm:col-span-2"
						description="仅填写群主或管理员取得的真实官方邀请链接；没有链接时留空。"
						label="官方邀请链接（可选）"
					>
						<Input
							className="min-h-11"
							onChange={(event) =>
								setForm({
									...form,
									group: { ...form.group, joinUrl: event.target.value || null },
								})
							}
							placeholder="QQ 或 Discord 官方 HTTPS 邀请链接"
							type="url"
							value={form.group.joinUrl ?? ""}
						/>
					</Field>
					{error ? (
						<div className="sm:col-span-2">
							<InlineError error={error} title="保存失败" />
						</div>
					) : null}
					<DialogFooter className="sm:col-span-2">
						<Button disabled={pending} onClick={onCancel} variant="ghost">
							取消
						</Button>
						<Button disabled={pending} type="submit">
							保存
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function ActionConfirmation({
	error,
	onCancel,
	onConfirm,
	pending,
	removal,
}: {
	error: unknown;
	onCancel: () => void;
	onConfirm: () => void;
	pending: boolean;
	removal: PendingRemoval;
}) {
	const title =
		removal.kind === "group"
			? `确定删除“${removal.group.name}”吗？`
			: `确定删除分组“${removal.section.name}”吗？`;
	const description =
		removal.kind === "group"
			? "删除后学生端将不再显示该群。"
			: removal.section.groups.length > 0
				? `该分组中的 ${removal.section.groups.length} 个群将同时删除。`
				: "该分组将从目录中删除。";
	return (
		<ConfirmDialog
			open
			onOpenChange={(open) => {
				if (!open) {
					onCancel();
				}
			}}
			title={title}
			description={description}
			confirmLabel="确认"
			pending={pending}
			onConfirm={onConfirm}
			error={error ? (error instanceof Error ? error.message : "删除失败，请重试。") : null}
		/>
	);
}
