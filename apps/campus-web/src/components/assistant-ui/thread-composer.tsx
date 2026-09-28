import { AuiIf, ComposerPrimitive, MessagePrimitive } from "@assistant-ui/react";
import { Button } from "@campus-agent/ui";
import { ArrowUpIcon, MicIcon, SquareIcon } from "lucide-react";
import { type FC, useContext } from "react";
import { ThreadSettingsContext } from "./thread-context";
import { TooltipIconButton } from "./tooltip-icon-button";

export const Composer: FC = () => {
	const { composerPlaceholder } = useContext(ThreadSettingsContext);

	return (
		<ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
			<div
				data-slot="aui_composer-shell"
				className="border-border focus-within:border-[var(--sys-border-strong)] flex w-full flex-col rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding) shadow-[var(--shadow-xs)] transition-[border-color,box-shadow] focus-within:shadow-[var(--shadow-sm)]"
			>
				<div className="flex min-h-11 items-end gap-2">
					<ComposerPrimitive.Input
						id="campus-chat-composer"
						name="message"
						placeholder={composerPlaceholder}
						className="aui-composer-input placeholder:text-muted-foreground/80 max-h-40 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-base leading-6 outline-none"
						rows={1}
						autoFocus
						aria-label="消息输入"
					/>
					<ComposerAction />
				</div>
			</div>
		</ComposerPrimitive.Root>
	);
};

const ComposerAction: FC = () => (
	<div className="aui-composer-action-wrapper relative flex shrink-0 items-center gap-1 pb-1">
		<AuiIf condition={(s) => s.thread.capabilities.dictation}>
			<AuiIf condition={(s) => s.composer.dictation == null}>
				<ComposerPrimitive.Dictate asChild>
					<TooltipIconButton
						tooltip="语音输入"
						side="bottom"
						type="button"
						variant="ghost"
						size="icon"
						className="aui-composer-dictate size-9 rounded-full after:-inset-1"
						aria-label="开始语音输入"
					>
						<MicIcon className="aui-composer-dictate-icon size-4" />
					</TooltipIconButton>
				</ComposerPrimitive.Dictate>
			</AuiIf>
			<AuiIf condition={(s) => s.composer.dictation != null}>
				<ComposerPrimitive.StopDictation asChild>
					<TooltipIconButton
						tooltip="停止语音输入"
						side="bottom"
						type="button"
						variant="ghost"
						size="icon"
						className="aui-composer-stop-dictation text-destructive size-9 rounded-full after:-inset-1"
						aria-label="停止语音输入"
					>
						<SquareIcon className="aui-composer-stop-dictation-icon size-3.5 animate-pulse fill-current" />
					</TooltipIconButton>
				</ComposerPrimitive.StopDictation>
			</AuiIf>
		</AuiIf>
		<AuiIf condition={(s) => !s.thread.isRunning}>
			<ComposerPrimitive.Send asChild>
				<TooltipIconButton
					tooltip="发送"
					side="bottom"
					type="button"
					variant="primary"
					size="icon"
					className="aui-composer-send bg-chat-accent text-chat-accent-foreground hover:bg-chat-accent-hover active:bg-chat-accent-pressed size-9 rounded-full border-chat-accent-foreground/20 after:-inset-1"
					aria-label="发送"
				>
					<ArrowUpIcon className="aui-composer-send-icon size-4.5" />
				</TooltipIconButton>
			</ComposerPrimitive.Send>
		</AuiIf>
		<AuiIf condition={(s) => s.thread.isRunning}>
			<ComposerPrimitive.Cancel asChild>
				<TooltipIconButton
					tooltip="停止生成"
					side="bottom"
					type="button"
					variant="primary"
					size="icon"
					className="aui-composer-cancel bg-chat-accent text-chat-accent-foreground hover:bg-chat-accent-hover active:bg-chat-accent-pressed size-9 rounded-full border-chat-accent-foreground/20 after:-inset-1"
					aria-label="停止生成"
				>
					<SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
				</TooltipIconButton>
			</ComposerPrimitive.Cancel>
		</AuiIf>
	</div>
);

export const EditComposer: FC = () => (
	<MessagePrimitive.Root
		data-slot="aui_edit-composer-wrapper"
		className="flex flex-col px-1 sm:px-2"
	>
		<ComposerPrimitive.Root className="aui-edit-composer-root border-border ms-auto flex w-full max-w-[88%] flex-col rounded-[22px] rounded-br-md border bg-(--composer-bg) shadow-[var(--shadow-xs)] sm:max-w-[78%]">
			<ComposerPrimitive.Input
				aria-label="编辑消息"
				className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none"
				id="campus-chat-edit-composer"
				name="edited-message"
				autoFocus
			/>
			<div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
				<ComposerPrimitive.Cancel asChild>
					<Button variant="ghost" size="sm" className="h-8 rounded-full px-3.5">
						取消
					</Button>
				</ComposerPrimitive.Cancel>
				<ComposerPrimitive.Send asChild>
					<Button size="sm" className="h-8 rounded-full px-3.5">
						更新
					</Button>
				</ComposerPrimitive.Send>
			</div>
		</ComposerPrimitive.Root>
	</MessagePrimitive.Root>
);
