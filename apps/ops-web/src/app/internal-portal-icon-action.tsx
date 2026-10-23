import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@campus-agent/ui";

export function InternalPortalIconAction(props: {
	icon: React.ReactNode;
	label: string;
	onClick?: () => void;
	variant?: "destructive" | "ghost";
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					aria-label={props.label}
					onClick={props.onClick}
					size="icon"
					variant={props.variant ?? "ghost"}
				>
					{props.icon}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{props.label}</TooltipContent>
		</Tooltip>
	);
}
