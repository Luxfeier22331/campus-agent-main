import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
	buttonVariants,
} from "@campus-agent/ui";
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
		<AlertDialog>
			<AlertDialogTrigger asChild>{props.trigger}</AlertDialogTrigger>
			<AlertDialogContent className="max-w-[30rem]">
				<AlertDialogHeader>
					<AlertDialogTitle>{props.title}</AlertDialogTitle>
					<AlertDialogDescription>{props.description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>取消</AlertDialogCancel>
					<AlertDialogAction
						className={buttonVariants({ variant: props.confirmVariant ?? "destructive" })}
						onClick={props.onConfirm}
					>
						{props.confirmLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
