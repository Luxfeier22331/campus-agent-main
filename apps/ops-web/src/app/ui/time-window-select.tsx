import { NativeSelect } from "@campus-agent/ui";
import {
	TIME_SCOPE,
	TIME_WINDOW_LABELS,
	type TimeScope,
	type TimeWindow,
} from "campus-contracts/ops-time";

export function timeWindowOptions(scope: TimeScope): Array<{ label: string; value: TimeWindow }> {
	return TIME_SCOPE[scope].windows.map((window) => ({
		label: TIME_WINDOW_LABELS[window],
		value: window,
	}));
}

export function TimeWindowSelect({
	accessibilityLabel,
	className,
	emptyLabel,
	id,
	name,
	onChange,
	scope,
	value,
}: {
	accessibilityLabel: string;
	className?: string;
	emptyLabel?: string;
	id?: string;
	name?: string;
	onChange: (value: TimeWindow | "") => void;
	scope: TimeScope;
	value: TimeWindow | "";
}) {
	return (
		<NativeSelect
			aria-label={accessibilityLabel}
			className={className}
			id={id}
			name={name}
			onChange={(event) => onChange(event.target.value as TimeWindow | "")}
			value={value}
		>
			{emptyLabel ? <option value="">{emptyLabel}</option> : null}
			{timeWindowOptions(scope).map((option) => (
				<option key={option.value} value={option.value}>
					{option.label}
				</option>
			))}
		</NativeSelect>
	);
}
