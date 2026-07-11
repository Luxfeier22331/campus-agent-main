import {
	type ColumnDef,
	createColumnHelper,
	flexRender,
	getCoreRowModel,
	useReactTable,
} from "@tanstack/react-table";

interface DataTableColumn<T> {
	cell: (row: T) => React.ReactNode;
	header: string;
}

export function DataTable<T>({
	caption,
	columns,
	data,
	minWidth = "760px",
	rowKey,
}: {
	caption?: string;
	columns: DataTableColumn<T>[];
	data: T[];
	minWidth?: string;
	rowKey: (row: T) => string;
}) {
	const columnHelper = createColumnHelper<T>();
	const tableColumns = columns.map((column) =>
		columnHelper.display({
			cell: (info) => column.cell(info.row.original),
			header: column.header,
			id: column.header,
		}),
	) as ColumnDef<T>[];
	const table = useReactTable({
		columns: tableColumns,
		data,
		getCoreRowModel: getCoreRowModel(),
		getRowId: rowKey,
	});
	const rows = table.getRowModel().rows;

	return (
		<div className="max-w-full rounded-lg border border-slate-200 bg-white">
			<div className="overflow-x-auto overscroll-x-contain">
				<div style={{ minWidth }}>
					<table
						aria-label={caption}
						className="w-full table-auto border-collapse text-left text-sm"
					>
						{caption ? <caption className="sr-only">{caption}</caption> : null}
						<thead>
							{table.getHeaderGroups().map((headerGroup) => (
								<tr key={headerGroup.id}>
									{headerGroup.headers.map((header) => (
										<th
											className="border-slate-200 border-b bg-slate-50 px-3 py-2 font-semibold text-slate-600 text-xs uppercase"
											key={header.id}
											scope="col"
										>
											{header.isPlaceholder
												? null
												: flexRender(header.column.columnDef.header, header.getContext())}
										</th>
									))}
								</tr>
							))}
						</thead>
						<tbody>
							{rows.map((row) => (
								<DataTableRow key={row.id} row={row} />
							))}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}

function DataTableRow<T>({
	row,
}: {
	row: ReturnType<ReturnType<typeof useReactTable<T>>["getRowModel"]>["rows"][number];
}) {
	return (
		<tr className="border-slate-100 border-b">
			{row.getVisibleCells().map((cell) => (
				<td className="break-words px-3 py-3 align-top" key={cell.id}>
					{flexRender(cell.column.columnDef.cell, cell.getContext())}
				</td>
			))}
		</tr>
	);
}
