import {
	NativeSelect,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@campus-agent/ui";
import { useIsMobile } from "@/hooks/use-mobile";

export interface AdaptiveSelectOption {
	label: string;
	value: string;
}

/**
 * 表单内的选择控件：移动端用原生 select（系统选择器、滚轮、无自定义弹层定位问题），
 * 桌面端保持 Radix Select。两者都带 combobox 语义与相同的控件样式。
 */
export function AdaptiveSelect(props: {
	"aria-label"?: string;
	id?: string;
	onValueChange(value: string): void;
	options: AdaptiveSelectOption[];
	value?: string;
}) {
	const isMobile = useIsMobile();
	if (isMobile) {
		return (
			<NativeSelect
				aria-label={props["aria-label"]}
				id={props.id}
				onChange={(event) => props.onValueChange(event.target.value)}
				value={props.value}
			>
				{props.options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</NativeSelect>
		);
	}
	return (
		<Select
			onValueChange={props.onValueChange}
			{...(props.value === undefined ? {} : { value: props.value })}
		>
			<SelectTrigger aria-label={props["aria-label"]} id={props.id}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{props.options.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
