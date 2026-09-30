import {
	cn,
	NativeSelect,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@campus-agent/ui";
import { useSyncExternalStore } from "react";

const desktopQuery = "(min-width: 768px)";
function subscribe(listener: () => void) {
	const media = window.matchMedia?.(desktopQuery);
	media?.addEventListener("change", listener);
	return () => media?.removeEventListener("change", listener);
}
const isDesktop = () => window.matchMedia?.(desktopQuery).matches ?? false;
const serverSnapshot = () => false;
const emptyValue = "__all__";

// Ops fields share the desktop Select and mobile system picker.
export function FilterSelect({
	options,
	value,
	onValueChange,
	onCloseAutoFocus,
	name,
	required,
	className,
	...props
}: {
	options: readonly { value: string; label: string; disabled?: boolean }[];
	value: string;
	onValueChange: (value: string) => void;
	onCloseAutoFocus?: (event: Event) => void;
	name?: string;
	id?: string;
	className?: string;
	disabled?: boolean;
	required?: boolean;
	"aria-label"?: string;
	"aria-describedby"?: string;
	"aria-invalid"?: boolean;
}) {
	const desktop = useSyncExternalStore(subscribe, isDesktop, serverSnapshot);
	if (!desktop) {
		return (
			<NativeSelect
				{...props}
				className={cn("min-h-11", className)}
				required={required}
				name={name}
				value={value}
				onChange={(event) => onValueChange(event.target.value)}
			>
				{options.map((option) => (
					<option key={option.value} value={option.value} disabled={option.disabled}>
						{option.label}
					</option>
				))}
			</NativeSelect>
		);
	}
	return (
		<Select
			items={options.map((option) => ({ value: option.value || emptyValue, label: option.label }))}
			value={value || (required ? "" : emptyValue)}
			onValueChange={(next) => onValueChange(next === emptyValue ? "" : next)}
			required={Boolean(required)}
			disabled={Boolean(props.disabled)}
		>
			<SelectTrigger {...props} className={cn("min-h-11", className)}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent onCloseAutoFocus={onCloseAutoFocus}>
				{options.map((option) => (
					<SelectItem
						key={option.value}
						value={option.value || emptyValue}
						disabled={Boolean(option.disabled)}
					>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
			{name ? <input type="hidden" name={name} value={value} disabled={props.disabled} /> : null}
		</Select>
	);
}
