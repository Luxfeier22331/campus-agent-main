import { TableCell, TableHead, TableRow } from "@mui/material";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { FieldTitle, useResourceContext } from "react-admin";

type DatagridFieldLike = ReactElement<{
	label?: string;
	source?: string;
	textAlign?: "left" | "center" | "right";
}> & {
	type: {
		textAlign?: "left" | "center" | "right";
	};
};

function ProtectedPanelDatagridHeaderCell(props: { field: DatagridFieldLike }) {
	const resource = useResourceContext();

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

export function PanelDatagridHeader(props: {
	children?: ReactNode;
}) {
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
						/>
					);
				})}
			</TableRow>
		</TableHead>
	);
}
