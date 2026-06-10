import { Link } from "@tanstack/react-router";
import { Archive, MoreHorizontal, Pencil, Pin, PinOff, Trash2, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import {
	archiveConversation,
	deleteConversation,
	pinConversation,
	renameConversation,
	unpinConversation,
} from "@/features/conversation/api";
import type { ConversationSummary } from "@/features/conversation/model";
import { cn } from "@/lib/utils";

export function ConversationRow({
	active,
	conversation,
	onArchived,
	onDeleted,
	onUpdated,
}: {
	active: boolean;
	conversation: ConversationSummary;
	onArchived: (conversationId: string) => void;
	onDeleted: (conversationId: string) => void;
	onUpdated: (conversation: ConversationSummary) => void;
}) {
	const [menuOpen, setMenuOpen] = useState(false);
	const [renameOpen, setRenameOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const buttonRef = useRef<HTMLButtonElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!menuOpen) {
			return;
		}
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				setMenuOpen(false);
			}
		}
		function handlePointerDown(event: PointerEvent) {
			const target = event.target;
			if (!(target instanceof Node)) {
				return;
			}
			if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) {
				return;
			}
			setMenuOpen(false);
		}
		window.addEventListener("keydown", handleKeyDown);
		document.addEventListener("pointerdown", handlePointerDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			document.removeEventListener("pointerdown", handlePointerDown);
		};
	}, [menuOpen]);

	async function runAction(action: () => Promise<void>) {
		if (busy) {
			return;
		}
		setBusy(true);
		setActionError(null);
		try {
			await action();
		} catch {
			setActionError("操作没有完成。");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="group relative flex min-h-9 items-center gap-1 rounded-lg hover:bg-[var(--sys-bg-muted)]">
			<Link
				className={cn(
					"min-w-0 flex-1 rounded-lg px-2.5 py-2 text-sm text-[var(--sys-text-muted)] hover:text-[var(--sys-text-strong)]",
					active && "font-medium text-[var(--sys-text-strong)]",
				)}
				params={{ conversationId: conversation.id }}
				to="/c/$conversationId"
			>
				<span className="truncate">{conversation.title}</span>
			</Link>
			<button
				aria-expanded={menuOpen}
				aria-haspopup="menu"
				aria-label={`会话操作：${conversation.title}`}
				className="mr-1 grid size-8 shrink-0 place-items-center rounded-lg text-[var(--sys-text-subtle)] opacity-100 hover:bg-white hover:text-[var(--sys-text-strong)] lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100"
				onClick={() => setMenuOpen((current) => !current)}
				ref={buttonRef}
				type="button"
			>
				<MoreHorizontal aria-hidden="true" className="size-4" />
			</button>
			{menuOpen ? (
				<div
					aria-label={`会话菜单：${conversation.title}`}
					className="absolute right-1 top-9 z-40 w-44 rounded-xl border border-[var(--sys-border-subtle)] bg-white p-1.5 shadow-[var(--shadow-md)]"
					ref={menuRef}
					role="menu"
				>
					<ConversationMenuButton
						icon={<Pencil aria-hidden="true" />}
						label="重命名"
						onClick={() => {
							setMenuOpen(false);
							setRenameOpen(true);
						}}
					/>
					<ConversationMenuButton
						icon={
							conversation.pinnedAt ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />
						}
						label={conversation.pinnedAt ? "取消置顶" : "置顶"}
						onClick={() =>
							runAction(async () => {
								const updated = conversation.pinnedAt
									? await unpinConversation(conversation.id)
									: await pinConversation(conversation.id);
								onUpdated(updated);
								setMenuOpen(false);
							})
						}
					/>
					<ConversationMenuButton
						icon={<Archive aria-hidden="true" />}
						label="归档"
						onClick={() =>
							runAction(async () => {
								await archiveConversation(conversation.id);
								onArchived(conversation.id);
								setMenuOpen(false);
							})
						}
					/>
					<div className="my-1 border-t border-[var(--sys-border-subtle)]" />
					<ConversationMenuButton
						destructive
						icon={<Trash2 aria-hidden="true" />}
						label="删除"
						onClick={() => {
							setMenuOpen(false);
							setDeleteOpen(true);
						}}
					/>
					{actionError ? (
						<p className="px-2 py-1 text-xs text-[var(--sys-status-danger)]">{actionError}</p>
					) : null}
				</div>
			) : null}
			{renameOpen ? (
				<RenameConversationDialog
					conversation={conversation}
					onClose={() => setRenameOpen(false)}
					onSaved={(updated) => {
						setRenameOpen(false);
						onUpdated(updated);
					}}
				/>
			) : null}
			{deleteOpen ? (
				<DeleteConversationDialog
					conversation={conversation}
					onClose={() => setDeleteOpen(false)}
					onDeleted={() => {
						setDeleteOpen(false);
						onDeleted(conversation.id);
					}}
				/>
			) : null}
		</div>
	);
}

function ConversationMenuButton({
	destructive,
	icon,
	label,
	onClick,
}: {
	destructive?: boolean;
	icon: ReactNode;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			className={cn(
				"flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-medium text-[var(--sys-text-strong)] hover:bg-[var(--sys-bg-muted)]",
				destructive && "text-[var(--sys-status-danger)]",
			)}
			onClick={onClick}
			role="menuitem"
			type="button"
		>
			<span className="grid size-4 place-items-center text-current [&_svg]:size-4">{icon}</span>
			<span className="truncate">{label}</span>
		</button>
	);
}

function RenameConversationDialog({
	conversation,
	onClose,
	onSaved,
}: {
	conversation: ConversationSummary;
	onClose: () => void;
	onSaved: (conversation: ConversationSummary) => void;
}) {
	const [title, setTitle] = useState(conversation.title);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		inputRef.current?.focus();
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				onClose();
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	async function handleSave() {
		const normalized = title.trim();
		if (!normalized || saving) {
			return;
		}
		setSaving(true);
		setError(null);
		try {
			const updated = await renameConversation({
				conversationId: conversation.id,
				title: normalized,
			});
			onSaved(updated);
		} catch {
			setError("名称没有保存。");
		} finally {
			setSaving(false);
		}
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--alpha-black-40)] px-4"
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) {
					onClose();
				}
			}}
		>
			<section
				aria-label="重命名会话"
				aria-modal="true"
				className="w-full max-w-[360px] rounded-2xl border border-[var(--sys-border-subtle)] bg-white p-5 shadow-[var(--shadow-md)]"
				role="dialog"
			>
				<div className="flex items-start justify-between gap-4">
					<h2 className="text-base font-semibold text-[var(--sys-text-strong)]">重命名会话</h2>
					<button
						aria-label="关闭"
						className="grid size-8 place-items-center rounded-lg text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)]"
						onClick={onClose}
						type="button"
					>
						<X aria-hidden="true" className="size-4" />
					</button>
				</div>
				<label className="mt-4 block text-sm font-medium text-[var(--sys-text-muted)]">
					会话名称
					<input
						className="mt-2 h-11 w-full rounded-xl border border-[var(--input-border)] px-3 text-sm text-[var(--sys-text-strong)] outline-none focus:border-[var(--focus-ring)]"
						onChange={(event) => setTitle(event.target.value)}
						ref={inputRef}
						value={title}
					/>
				</label>
				{error ? <p className="mt-2 text-xs text-[var(--sys-status-danger)]">{error}</p> : null}
				<div className="mt-5 flex justify-end gap-2">
					<button
						className="min-h-10 rounded-lg px-3 text-sm font-medium text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)]"
						onClick={onClose}
						type="button"
					>
						取消
					</button>
					<button
						className="min-h-10 rounded-lg bg-[var(--sys-text-strong)] px-4 text-sm font-medium text-white disabled:bg-[var(--state-disabled-bg)] disabled:text-[var(--state-disabled-text)]"
						disabled={!title.trim() || saving}
						onClick={handleSave}
						type="button"
					>
						{saving ? "保存中" : "保存"}
					</button>
				</div>
			</section>
		</div>
	);
}

function DeleteConversationDialog({
	conversation,
	onClose,
	onDeleted,
}: {
	conversation: ConversationSummary;
	onClose: () => void;
	onDeleted: () => void;
}) {
	const [deleting, setDeleting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				onClose();
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	async function handleDelete() {
		if (deleting) {
			return;
		}
		setDeleting(true);
		setError(null);
		try {
			await deleteConversation(conversation.id);
			onDeleted();
		} catch {
			setError("会话没有删除。");
			setDeleting(false);
		}
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--alpha-black-40)] px-4"
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) {
					onClose();
				}
			}}
		>
			<section
				aria-label="删除会话"
				aria-modal="true"
				className="w-full max-w-[360px] rounded-2xl border border-[var(--sys-border-subtle)] bg-white p-5 shadow-[var(--shadow-md)]"
				role="dialog"
			>
				<div className="flex items-start justify-between gap-4">
					<h2 className="text-base font-semibold text-[var(--sys-text-strong)]">删除会话</h2>
					<button
						aria-label="关闭"
						className="grid size-8 place-items-center rounded-lg text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)]"
						onClick={onClose}
						type="button"
					>
						<X aria-hidden="true" className="size-4" />
					</button>
				</div>
				<p className="mt-3 text-sm leading-6 text-[var(--sys-text-muted)]">
					删除后，这条会话不会再出现在历史记录中。
				</p>
				<p className="mt-2 truncate text-sm font-medium text-[var(--sys-text-strong)]">
					{conversation.title}
				</p>
				{error ? <p className="mt-3 text-xs text-[var(--sys-status-danger)]">{error}</p> : null}
				<div className="mt-5 flex justify-end gap-2">
					<button
						className="min-h-10 rounded-lg px-3 text-sm font-medium text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)]"
						onClick={onClose}
						type="button"
					>
						取消
					</button>
					<button
						className="min-h-10 rounded-lg bg-[var(--sys-status-danger)] px-4 text-sm font-medium text-white disabled:bg-[var(--state-disabled-bg)] disabled:text-[var(--state-disabled-text)]"
						disabled={deleting}
						onClick={handleDelete}
						type="button"
					>
						{deleting ? "删除中" : "确认删除"}
					</button>
				</div>
			</section>
		</div>
	);
}
