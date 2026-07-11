import { boolean, index, integer, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

const observability = pgSchema("observability");

export const opsObservabilityReadAudit = observability.table(
	"ops_observability_read_audit",
	{
		auditId: text("audit_id").primaryKey(),
		kind: text("kind").notNull(),
		operatorId: text("operator_id").notNull(),
		operatorPrincipalClass: text("operator_principal_class").notNull(),
		readAt: timestamp("read_at", { withTimezone: true }).notNull(),
		recordCount: integer("record_count").notNull(),
		requestId: text("request_id").notNull(),
		traceId: text("trace_id").notNull(),
		truncated: boolean("truncated").notNull(),
	},
	(table) => ({
		readAtIndex: index("observability_ops_read_at_idx").on(table.readAt),
		requestReadAtIndex: index("observability_ops_read_request_at_idx").on(
			table.requestId,
			table.readAt,
		),
	}),
);
