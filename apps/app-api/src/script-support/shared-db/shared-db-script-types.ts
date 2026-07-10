export interface NormalizedColumnSpec {
	defaultValue: unknown;
	name: string;
	notNull: boolean;
	primaryKey: boolean;
	type: string;
}

export interface NormalizedIndexSpec {
	columns: string[];
	method: string | null;
	name: string;
	unique: boolean | null;
}

export interface TableSpec {
	columns: Map<string, NormalizedColumnSpec>;
	constraints: Set<string>;
	indexes: Map<string, NormalizedIndexSpec>;
	schema: string;
	table: string;
}

export type TableSpecMap = Map<string, TableSpec>;

export interface MigrationJournalEntry {
	idx?: number;
	tag: string;
}

export interface MigrationJournal {
	entries: MigrationJournalEntry[];
}

export interface SnapshotColumnSpec {
	default?: unknown;
	name: string;
	notNull?: boolean;
	primaryKey?: boolean;
	type: string;
}

export interface SnapshotIndexColumnSpec {
	expression: string;
}

export interface SnapshotIndexSpec {
	columns?: SnapshotIndexColumnSpec[];
	isUnique?: boolean;
	method?: string;
}

export interface SnapshotCompositePrimaryKey {
	columns?: string[];
}

export interface SnapshotTableSpec {
	columns?: Record<string, SnapshotColumnSpec>;
	compositePrimaryKeys?: Record<string, SnapshotCompositePrimaryKey>;
	foreignKeys?: Record<string, unknown>;
	indexes?: Record<string, SnapshotIndexSpec>;
	name: string;
	schema: string;
}

export interface DrizzleSnapshot {
	tables?: Record<string, SnapshotTableSpec>;
}
