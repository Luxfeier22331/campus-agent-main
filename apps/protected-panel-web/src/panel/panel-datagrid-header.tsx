import { TableCell, TableHead, TableRow, TableSortLabel, Tooltip } from "@mui/material";
import {
	Children,
	isValidElement,
	type MouseEvent,
	type ReactElement,
	type ReactNode,
} from "react";
import {
	FieldTitle,
	type RaRecord,
	type SortPayload,
	useListContextWithProps,
	useResourceContext,
} from "react-admin";

import { formatPanelSortLabel } from "./panel-copy";

const OPPOSITE_ORDER: Record<SortPayload["order"], SortPayload["order"]> = {
	ASC: "DESC",
	DESC: "ASC",
};

type DatagridFieldLike = ReactElement<{
	label?: string;
	sortable?: boolean;
	sortBy?: string;
	sortByOrder?: SortPayload["order"];
	source?: string;
	textAlign?: "left" | "center" | "right";
}> & {
	type: {
		sortable?: boolean;
		textAlign?: "left" | "center" | "right";
	};
};

function resolveFieldLabel(field: DatagridFieldLike) {
	if (typeof field.props.label === "string" && field.props.label.trim()) {
		return field.props.label;
	}

	if (typeof field.props.source === "string" && field.props.source.trim()) {
		return field.props.source;
	}

	return null;
}

function ProtectedPanelDatagridHeaderCell(props: {
	field: DatagridFieldLike;
	sort?: SortPayload;
	updateSort?: (event: MouseEvent<HTMLElement>) => void;
}) {
	const resource = useResourceContext();
	const sortField = props.field.props.sortBy || props.field.props.source;
	const nextSortOrder = sortField
		? props.sort?.field === sortField
			? OPPOSITE_ORDER[props.sort.order]
			: (props.field.props.sortByOrder ?? "ASC")
		: undefined;
	const sortLabel = nextSortOrder
		? formatPanelSortLabel({
				fieldLabel: resolveFieldLabel(props.field),
				order: nextSortOrder,
			})
		: undefined;

	if (
		props.updateSort &&
		props.sort &&
		sortField &&
		props.field.props.sortable !== false &&
		props.field.type.sortable !== false
	) {
		return (
			<TableCell align={props.field.props.textAlign || props.field.type.textAlign} variant="head">
				<Tooltip enterDelay={300} title={sortLabel}>
					<TableSortLabel
						active={props.sort.field === sortField}
						aria-label={sortLabel}
						data-field={sortField}
						data-order={props.field.props.sortByOrder || "ASC"}
						direction={props.sort.order === "ASC" ? "asc" : "desc"}
						onClick={props.updateSort}
					>
						<FieldTitle
							label={props.field.props.label}
							resource={resource}
							source={props.field.props.source}
						/>
					</TableSortLabel>
				</Tooltip>
			</TableCell>
		);
	}

	return (
		<TableCell align={props.field.props.textAlign || props.field.type.textAlign} variant="head">
			<FieldTitle
				label={props.field.props.label}
				resource={resource}
				source={props.field.props.source}
			/>
		</TableCell>
	);
}

export function PanelDatagridHeader<RecordType extends RaRecord = any>(props: {
	children?: ReactNode;
	sort?: SortPayload;
	setSort?: (sort: SortPayload) => void;
}) {
	const { sort, setSort } = useListContextWithProps<RecordType>(props);

	return (
		<TableHead>
			<TableRow>
				{Children.map(props.children, (field, index) => {
					if (!isValidElement(field)) {
						return null;
					}

					return (
						<ProtectedPanelDatagridHeaderCell
							field={field as DatagridFieldLike}
							key={(field.props as { source?: string }).source || index}
							sort={sort}
							updateSort={
								setSort
									? (event) => {
											event.stopPropagation();
											const target = event.currentTarget as HTMLElement;
											const newField = target.dataset.field;
											const defaultOrder = target.dataset.order as SortPayload["order"] | undefined;

											if (!newField) {
												return;
											}

											const newOrder =
												sort?.field === newField
													? sort.order === "ASC"
														? "DESC"
														: "ASC"
													: (defaultOrder ?? "ASC");

											setSort({ field: newField, order: newOrder });
										}
									: undefined
							}
						/>
					);
				})}
			</TableRow>
		</TableHead>
	);
}
