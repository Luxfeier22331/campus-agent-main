import { recordFromFieldMap } from "./field-mapping";
import type { DiningSourceRecord } from "./types";

export interface LarkRecordListEnvelope {
	data: {
		data: unknown[][];
		field_id_list: string[];
		fields: string[];
		record_id_list: string[];
	};
	ok: boolean;
}

export function parseLarkRecordList(envelope: LarkRecordListEnvelope): DiningSourceRecord[] {
	if (!envelope.ok) {
		throw new Error("Lark record-list response is not ok.");
	}
	const fieldIds = envelope.data.field_id_list;
	const rows = envelope.data.data;
	const recordIds = envelope.data.record_id_list;
	if (rows.length !== recordIds.length) {
		throw new Error("Lark record-list row count does not match record IDs.");
	}
	return rows.map((row, index) => {
		if (row.length !== fieldIds.length) {
			throw new Error("Lark record-list field count does not match row cells.");
		}
		const cells = new Map(fieldIds.map((fieldId, cellIndex) => [fieldId, row[cellIndex]]));
		const sourceRecordId = recordIds[index];
		if (!sourceRecordId) {
			throw new Error("Lark record-list row is missing record ID.");
		}
		return recordFromFieldMap({ fields: cells, sourceRecordId });
	});
}
