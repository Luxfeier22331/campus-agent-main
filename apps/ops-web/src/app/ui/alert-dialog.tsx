import { Button } from "@campus-agent/ui";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import type { ReactNode } from "react";

export function ConfirmAction(props: {
	confirmLabel: string;
	confirmVariant?: "destructive" | "primary";
	description: string;
	onConfirm: () => void;
	title: string;
	trigger: ReactNode;
}) {
	return (
		<AlertDialogPrimitive.Root>
			<AlertDialogPrimitive.Trigger asChild>{props.trigger}</AlertDialogPrimitive.Trigger>
			<AlertDialogPrimitive.Portal>
				<AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/35" />
				<AlertDialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 grid w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-background p-6 shadow-xl outline-none">
					<AlertDialogPrimitive.Title className="font-semibold text-lg">
						{props.title}
					</AlertDialogPrimitive.Title>
					<AlertDialogPrimitive.Description className="text-muted-foreground text-sm">
						{props.description}
					</AlertDialogPrimitive.Description>
					<div className="flex justify-end gap-2">
						<AlertDialogPrimitive.Cancel asChild>
							<Button variant="outline">取消</Button>
						</AlertDialogPrimitive.Cancel>
						<AlertDialogPrimitive.Action asChild>
							<Button onClick={props.onConfirm} variant={props.confirmVariant ?? "destructive"}>
								{props.confirmLabel}
							</Button>
						</AlertDialogPrimitive.Action>
					</div>
				</AlertDialogPrimitive.Content>
			</AlertDialogPrimitive.Portal>
		</AlertDialogPrimitive.Root>
	);
}
