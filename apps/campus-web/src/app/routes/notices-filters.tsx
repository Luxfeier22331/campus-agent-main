import {
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@campus-agent/ui";
import { CampusDateRangePicker } from "@/components/ui/date-picker";

export function FilterSelect(props: {
	id: string;
	label: string;
	onChange: (value: string | undefined) => void;
	options: ReadonlyArray<{ label: string; value: string }>;
	value: string | undefined;
}) {
	return (
		<div>
			<Label className="sr-only" htmlFor={props.id}>
				{props.label}
			</Label>
			<Select
				onValueChange={(value) => props.onChange(value === "all" ? undefined : value)}
				value={props.value ?? "all"}
			>
				<SelectTrigger aria-label={props.label} className="w-auto max-w-56" id={props.id}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent align="start">
					<SelectItem value="all">全部分类</SelectItem>
					{props.options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

export function DateRangeFilter(props: {
	from: string | undefined;
	onApply: (range: { from: string | undefined; to: string | undefined }) => void;
	to: string | undefined;
}) {
	return <CampusDateRangePicker from={props.from} onApply={props.onApply} to={props.to} />;
}
