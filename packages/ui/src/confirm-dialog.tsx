import { type ReactElement, type ReactNode, type RefObject, useId, useRef } from "react";
import { Button } from "./button";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "./dialog";

export interface ConfirmDialogProps {
	open: boolean;
	onOpenChange(open: boolean): void;
	title: ReactNode;
	description: ReactNode;
	confirmLabel: string;
	onConfirm(): void;
	trigger?: ReactElement;
	cancelLabel?: string;
	confirmVariant?: "primary" | "destructive";
	pending?: boolean;
	pendingLabel?: string;
	confirmDisabled?: boolean;
	error?: ReactNode;
	children?: ReactNode;
	fallbackFocusRef?: RefObject<HTMLElement | null>;
	/** Associates optional controls with the footer form without nesting other forms. */
	formId?: string;
}

export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel,
	onConfirm,
	trigger,
	cancelLabel = "取消",
	confirmVariant = "destructive",
	pending = false,
	pendingLabel = "处理中…",
	confirmDisabled = false,
	error,
	children,
	fallbackFocusRef,
	formId,
}: ConfirmDialogProps) {
	const generatedId = useId();
	const previousFocus = useRef<HTMLElement | null>(null);
	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				if (!pending) {
					onOpenChange(next);
				}
			}}
		>
			{trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
			<AlertDialogContent
				onOpenAutoFocus={() => {
					previousFocus.current =
						document.activeElement instanceof HTMLElement ? document.activeElement : null;
				}}
				onCloseAutoFocus={(event) => {
					const previous = previousFocus.current;
					const target =
						previous?.isConnected && previous !== document.body
							? previous
							: fallbackFocusRef?.current;
					if (target?.isConnected) {
						event.preventDefault();
						target.focus();
					}
				}}
				onEscapeKeyDown={(event) => {
					if (pending) {
						event.preventDefault();
					}
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				{children}
				{error ? (
					<div role="alert" className="grid gap-2 text-sm text-danger">
						{error}
					</div>
				) : null}
				<form
					id={formId ?? generatedId}
					onSubmit={(event) => {
						event.preventDefault();
						if (!(pending || confirmDisabled)) {
							onConfirm();
						}
					}}
				>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
						<Button
							type="submit"
							variant={confirmVariant}
							disabled={pending || confirmDisabled}
							aria-busy={pending || undefined}
						>
							{pending ? pendingLabel : confirmLabel}
						</Button>
					</AlertDialogFooter>
				</form>
			</AlertDialogContent>
		</AlertDialog>
	);
}
