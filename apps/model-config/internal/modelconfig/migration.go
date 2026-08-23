package modelconfig

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

const migrationVersion = 1

const (
	schemaOwnerRole = "campus_agent"
	runtimeRole     = "model_config"
)

type expectedColumn struct {
	name        string
	dataType    string
	notNull     bool
	defaultExpr string
}

var modelConfigsColumns = []expectedColumn{
	{name: "name", dataType: "text", notNull: true},
	{name: "provider", dataType: "text", notNull: true},
	{name: "api_protocol", dataType: "text", notNull: true},
	{name: "base_url", dataType: "text", notNull: true},
	{name: "model", dataType: "text", notNull: true},
	{name: "encrypted_api_key", dataType: "bytea", notNull: true},
	{name: "validation_status", dataType: "text", notNull: true},
	{name: "validation_error_code", dataType: "text", notNull: true, defaultExpr: "''::text"},
	{name: "validation_message", dataType: "text", notNull: true, defaultExpr: "''::text"},
	{name: "validation_observed_dimensions", dataType: "integer"},
	{name: "validated_at", dataType: "timestamp with time zone", notNull: true},
	{name: "validated_by", dataType: "text", notNull: true},
	{name: "updated_at", dataType: "timestamp with time zone", notNull: true},
	{name: "updated_by", dataType: "text", notNull: true},
}

var schemaMigrationsColumns = []expectedColumn{
	{name: "version", dataType: "integer", notNull: true},
	{name: "applied_at", dataType: "timestamp with time zone", notNull: true},
}

type expectedConstraint struct {
	name       string
	constraint string
	definition string
}

var modelConfigsConstraints = []expectedConstraint{
	{name: "model_configs_name_check", constraint: "c", definition: "CHECK (name = ANY (ARRAY['primary_agent'::text, 'campus_docs_embedding'::text, 'campus_docs_reranker'::text, 'notice_classification'::text]))"},
	{name: "model_configs_pkey", constraint: "p", definition: "PRIMARY KEY (name)"},
	{name: "model_configs_validation_status_check", constraint: "c", definition: "CHECK (validation_status = ANY (ARRAY['passed'::text, 'failed'::text]))"},
}

var schemaMigrationsConstraints = []expectedConstraint{
	{name: "schema_migrations_pkey", constraint: "p", definition: "PRIMARY KEY (version)"},
}

type expectedIndex struct {
	name      string
	unique    bool
	primary   bool
	columns   string
	method    string
	predicate string
}

var modelConfigIndexes = []expectedIndex{
	{name: "model_configs_pkey", unique: true, primary: true, columns: "name", method: "btree"},
	{name: "schema_migrations_pkey", unique: true, primary: true, columns: "version", method: "btree"},
}

func Install(ctx context.Context, databaseURL, newKeyPath, legacyKeyPath string) error {
	newCipher, err := LoadCipher(newKeyPath)
	if err != nil {
		return fmt.Errorf("load model config encryption key: %w", err)
	}
	legacyCipher, err := LoadCipher(legacyKeyPath)
	if err != nil && strings.TrimSpace(legacyKeyPath) != "" {
		return fmt.Errorf("load legacy model config encryption key: %w", err)
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(0)
	defer func() { _ = db.Close() }()
	if err := pingDatabase(ctx, db); err != nil {
		return err
	}
	if err := requireSchemaOwnerConnection(ctx, db); err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, `create schema if not exists model_config`); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `create table if not exists model_config.model_configs(
		name text primary key constraint model_configs_name_check check (name in ('primary_agent','campus_docs_embedding','campus_docs_reranker','notice_classification')),
		provider text not null,
		api_protocol text not null,
		base_url text not null,
		model text not null,
		encrypted_api_key bytea not null,
		validation_status text not null check (validation_status in ('passed','failed')),
		validation_error_code text not null default '',
		validation_message text not null default '',
		validation_observed_dimensions integer,
		validated_at timestamptz not null,
		validated_by text not null,
		updated_at timestamptz not null,
		updated_by text not null
	)`); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `create table if not exists model_config.schema_migrations(version integer primary key, applied_at timestamptz not null)`); err != nil {
		return err
	}
	if err := checkSchemaStructure(ctx, tx); err != nil {
		return err
	}
	if err := migrateLegacyModelSettings(ctx, tx, legacyCipher, newCipher); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `insert into model_config.schema_migrations(version,applied_at) values($1,$2) on conflict(version) do nothing`, migrationVersion, time.Now().UTC()); err != nil {
		return err
	}
	if err := checkMigrationLedger(ctx, tx); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `revoke all privileges on schema model_config from public; grant usage on schema model_config to model_config`); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `revoke all privileges on table model_config.model_configs from public; grant select,insert,update on table model_config.model_configs to model_config`); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `revoke all privileges on table model_config.schema_migrations from public; grant select on table model_config.schema_migrations to model_config`); err != nil {
		return err
	}
	if err := checkSchemaGrants(ctx, tx); err != nil {
		return err
	}
	return tx.Commit()
}

func requireSchemaOwnerConnection(ctx context.Context, db *sql.DB) error {
	var currentUser string
	if err := db.QueryRowContext(ctx, "select current_user").Scan(&currentUser); err != nil {
		return fmt.Errorf("inspect model config schema owner connection: %w", err)
	}
	if currentUser != schemaOwnerRole {
		return fmt.Errorf("model-config schema command must connect as %s, got %s", schemaOwnerRole, currentUser)
	}
	var runtimeRoleExists bool
	if err := db.QueryRowContext(ctx, "select exists(select 1 from pg_roles where rolname=$1)", runtimeRole).Scan(&runtimeRoleExists); err != nil {
		return fmt.Errorf("inspect model config runtime role: %w", err)
	}
	if !runtimeRoleExists {
		return fmt.Errorf("database role %s is not installed", runtimeRole)
	}
	return nil
}

func pingDatabase(ctx context.Context, db *sql.DB) error {
	const retryInterval = 2 * time.Second

	var lastErr error
	ticker := time.NewTicker(retryInterval)
	defer ticker.Stop()
	for {
		if err := db.PingContext(ctx); err == nil {
			return nil
		} else {
			lastErr = err
		}

		select {
		case <-ctx.Done():
			return lastErr
		case <-ticker.C:
		}
	}
}

func checkSchemaStructure(ctx context.Context, tx *sql.Tx) error {
	var schemaOwner string
	if err := tx.QueryRowContext(ctx, `select pg_get_userbyid(nspowner) from pg_namespace where nspname='model_config'`).Scan(&schemaOwner); err != nil {
		return fmt.Errorf("inspect model_config schema owner: %w", err)
	}
	if schemaOwner != schemaOwnerRole {
		return fmt.Errorf("model_config schema owner = %s, want %s", schemaOwner, schemaOwnerRole)
	}
	if err := checkRelations(ctx, tx); err != nil {
		return err
	}
	if err := checkTable(ctx, tx, "model_configs", modelConfigsColumns, modelConfigsConstraints); err != nil {
		return err
	}
	if err := checkTable(ctx, tx, "schema_migrations", schemaMigrationsColumns, schemaMigrationsConstraints); err != nil {
		return err
	}
	return checkIndexes(ctx, tx)
}

func checkRelations(ctx context.Context, tx *sql.Tx) error {
	rows, err := tx.QueryContext(ctx, `select relation.relname, relation.relkind from pg_class as relation join pg_namespace as namespace on namespace.oid=relation.relnamespace where namespace.nspname='model_config' and relation.relkind in ('r','p','v','m','f','S') order by relation.relname`)
	if err != nil {
		return fmt.Errorf("inspect model_config relations: %w", err)
	}
	defer func() { _ = rows.Close() }()
	want := map[string]string{"model_configs": "r", "schema_migrations": "r"}
	got := make(map[string]string)
	for rows.Next() {
		var name, kind string
		if err := rows.Scan(&name, &kind); err != nil {
			return fmt.Errorf("scan model_config relations: %w", err)
		}
		got[name] = kind
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read model_config relations: %w", err)
	}
	if len(got) != len(want) {
		return fmt.Errorf("model_config schema has unexpected relations: %v", got)
	}
	for name, kind := range want {
		if got[name] != kind {
			return fmt.Errorf("model_config relation %s = %q, want %q", name, got[name], kind)
		}
	}
	return nil
}

func checkTable(ctx context.Context, tx *sql.Tx, table string, wantColumns []expectedColumn, wantConstraints []expectedConstraint) error {
	var owner, kind string
	if err := tx.QueryRowContext(ctx, `select pg_get_userbyid(relation.relowner), relation.relkind from pg_class as relation join pg_namespace as namespace on namespace.oid=relation.relnamespace where namespace.nspname='model_config' and relation.relname=$1`, table).Scan(&owner, &kind); err != nil {
		return fmt.Errorf("inspect model_config.%s metadata: %w", table, err)
	}
	if owner != schemaOwnerRole || kind != "r" {
		return fmt.Errorf("model_config.%s owner/kind = %s/%s, want %s/r", table, owner, kind, schemaOwnerRole)
	}
	if err := checkColumns(ctx, tx, table, wantColumns); err != nil {
		return err
	}
	return checkConstraints(ctx, tx, table, wantConstraints)
}

func checkColumns(ctx context.Context, tx *sql.Tx, table string, want []expectedColumn) error {
	rows, err := tx.QueryContext(ctx, `select attribute.attname, format_type(attribute.atttypid, attribute.atttypmod), attribute.attnotnull, coalesce(pg_get_expr(default_value.adbin, default_value.adrelid),'') from pg_attribute as attribute left join pg_attrdef as default_value on default_value.adrelid=attribute.attrelid and default_value.adnum=attribute.attnum where attribute.attrelid=to_regclass($1) and attribute.attnum>0 and not attribute.attisdropped order by attribute.attnum`, "model_config."+table)
	if err != nil {
		return fmt.Errorf("inspect model_config.%s columns: %w", table, err)
	}
	defer func() { _ = rows.Close() }()
	for index := range want {
		if !rows.Next() {
			if err := rows.Err(); err != nil {
				return fmt.Errorf("read model_config.%s columns: %w", table, err)
			}
			return fmt.Errorf("model_config.%s has unexpected columns: fewer than expected", table)
		}
		var got expectedColumn
		if err := rows.Scan(&got.name, &got.dataType, &got.notNull, &got.defaultExpr); err != nil {
			return fmt.Errorf("scan model_config.%s columns: %w", table, err)
		}
		if got != want[index] {
			return fmt.Errorf("model_config.%s column %d = %#v, want %#v", table, index+1, got, want[index])
		}
	}
	if rows.Next() {
		return fmt.Errorf("model_config.%s has unexpected columns: more than expected", table)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read model_config.%s columns: %w", table, err)
	}
	return nil
}

func checkConstraints(ctx context.Context, tx *sql.Tx, table string, want []expectedConstraint) error {
	rows, err := tx.QueryContext(ctx, `select constraint_metadata.conname, constraint_metadata.contype, pg_get_constraintdef(constraint_metadata.oid, true), constraint_metadata.convalidated from pg_constraint as constraint_metadata where constraint_metadata.conrelid=to_regclass($1) order by constraint_metadata.conname`, "model_config."+table)
	if err != nil {
		return fmt.Errorf("inspect model_config.%s constraints: %w", table, err)
	}
	defer func() { _ = rows.Close() }()
	actual := make([]expectedConstraint, 0, len(want))
	for rows.Next() {
		var item expectedConstraint
		var validated bool
		if err := rows.Scan(&item.name, &item.constraint, &item.definition, &validated); err != nil {
			return fmt.Errorf("scan model_config.%s constraints: %w", table, err)
		}
		if !validated {
			return fmt.Errorf("model_config.%s constraint %s is not validated", table, item.name)
		}
		item.definition = normalizeSQL(item.definition)
		actual = append(actual, item)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read model_config.%s constraints: %w", table, err)
	}
	normalizedWant := append([]expectedConstraint(nil), want...)
	for index := range normalizedWant {
		normalizedWant[index].definition = normalizeSQL(normalizedWant[index].definition)
	}
	if len(actual) != len(normalizedWant) {
		return fmt.Errorf("model_config.%s has unexpected constraints: %#v", table, actual)
	}
	for index := range normalizedWant {
		if actual[index] != normalizedWant[index] {
			return fmt.Errorf("model_config.%s constraint %d = %#v, want %#v", table, index+1, actual[index], normalizedWant[index])
		}
	}
	return nil
}

func checkIndexes(ctx context.Context, tx *sql.Tx) error {
	rows, err := tx.QueryContext(ctx, `select index_relation.relname, index_metadata.indisunique, index_metadata.indisprimary, array_to_string(array(select attribute.attname::text from unnest(index_metadata.indkey) with ordinality as key(attnum, ordinality) join pg_attribute as attribute on attribute.attrelid=index_metadata.indrelid and attribute.attnum=key.attnum where key.ordinality<=index_metadata.indnkeyatts order by key.ordinality), ','), access_method.amname, coalesce(pg_get_expr(index_metadata.indpred, index_metadata.indrelid), '') from pg_index as index_metadata join pg_class as relation on relation.oid=index_metadata.indrelid join pg_namespace as namespace on namespace.oid=relation.relnamespace join pg_class as index_relation on index_relation.oid=index_metadata.indexrelid join pg_am as access_method on access_method.oid=index_relation.relam where namespace.nspname='model_config' and index_metadata.indisvalid and index_metadata.indisready order by index_relation.relname`)
	if err != nil {
		return fmt.Errorf("inspect model_config indexes: %w", err)
	}
	defer func() { _ = rows.Close() }()
	actual := []expectedIndex{}
	for rows.Next() {
		var item expectedIndex
		if err := rows.Scan(&item.name, &item.unique, &item.primary, &item.columns, &item.method, &item.predicate); err != nil {
			return fmt.Errorf("scan model_config indexes: %w", err)
		}
		item.predicate = normalizeSQL(item.predicate)
		actual = append(actual, item)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read model_config indexes: %w", err)
	}
	if len(actual) != len(modelConfigIndexes) {
		return fmt.Errorf("model_config schema has unexpected indexes: %#v", actual)
	}
	normalizedWant := append([]expectedIndex(nil), modelConfigIndexes...)
	for index := range normalizedWant {
		normalizedWant[index].predicate = normalizeSQL(normalizedWant[index].predicate)
		if actual[index] != normalizedWant[index] {
			return fmt.Errorf("model_config index %d = %#v, want %#v", index+1, actual[index], normalizedWant[index])
		}
	}
	return nil
}

func checkSchemaGrants(ctx context.Context, tx *sql.Tx) error {
	for _, privilege := range []string{"USAGE", "CREATE"} {
		want := privilege == "USAGE"
		if err := requirePrivilege(ctx, tx, "schema", runtimeRole, "model_config", privilege, want); err != nil {
			return err
		}
		if err := requirePrivilege(ctx, tx, "schema", "public", "model_config", privilege, false); err != nil {
			return err
		}
	}
	for _, privilege := range []string{"SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"} {
		want := privilege == "SELECT" || privilege == "INSERT" || privilege == "UPDATE"
		if err := requirePrivilege(ctx, tx, "table", runtimeRole, "model_config.model_configs", privilege, want); err != nil {
			return err
		}
		if err := requirePrivilege(ctx, tx, "table", "public", "model_config.model_configs", privilege, false); err != nil {
			return err
		}
	}
	for _, privilege := range []string{"SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"} {
		want := privilege == "SELECT"
		if err := requirePrivilege(ctx, tx, "table", runtimeRole, "model_config.schema_migrations", privilege, want); err != nil {
			return err
		}
		if err := requirePrivilege(ctx, tx, "table", "public", "model_config.schema_migrations", privilege, false); err != nil {
			return err
		}
	}
	return nil
}

func requirePrivilege(ctx context.Context, tx *sql.Tx, objectType, role, object, privilege string, want bool) error {
	function := "has_" + objectType + "_privilege"
	query := fmt.Sprintf("select %s($1,$2,$3)", function)
	var granted bool
	if err := tx.QueryRowContext(ctx, query, role, object, privilege).Scan(&granted); err != nil {
		return fmt.Errorf("inspect %s role %s %s on %s: %w", objectType, role, privilege, object, err)
	}
	if granted != want {
		return fmt.Errorf("database role %s %s on %s = %t, want %t", role, privilege, object, granted, want)
	}
	return nil
}

func checkMigrationLedger(ctx context.Context, tx *sql.Tx) error {
	rows, err := tx.QueryContext(ctx, `select version from model_config.schema_migrations order by version`)
	if err != nil {
		return fmt.Errorf("inspect model_config migration ledger: %w", err)
	}
	defer func() { _ = rows.Close() }()
	versions := []int{}
	for rows.Next() {
		var version int
		if err := rows.Scan(&version); err != nil {
			return fmt.Errorf("scan model_config migration ledger: %w", err)
		}
		versions = append(versions, version)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read model_config migration ledger: %w", err)
	}
	if len(versions) != 1 || versions[0] != migrationVersion {
		return fmt.Errorf("model_config migration ledger = %v, want [%d]", versions, migrationVersion)
	}
	return nil
}

func normalizeSQL(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func migrateLegacyModelSettings(ctx context.Context, tx *sql.Tx, legacy, current *Cipher) error {
	var exists bool
	if err := tx.QueryRowContext(ctx, `select to_regclass('execution_control.model_settings') is not null`).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return nil
	}
	if legacy == nil {
		return errors.New("legacy encryption key is required while execution_control.model_settings exists")
	}
	rows, err := tx.QueryContext(ctx, `select kind,provider,base_url,model,transport,secret_nonce,secret_ciphertext,validation_status,validation_error_code,validation_message,coalesce(validation_observed_dimensions,0),validated_at,validated_by,updated_at,updated_by from execution_control.model_settings order by kind`)
	if err != nil {
		return err
	}
	type legacyRow struct {
		kind, provider, baseURL, model, transport           string
		nonce, ciphertext                                   []byte
		validationStatus, validationCode, validationMessage string
		dimensions                                          int
		validatedAt                                         time.Time
		validatedBy                                         string
		updatedAt                                           time.Time
		updatedBy                                           string
	}
	items := []legacyRow{}
	for rows.Next() {
		var item legacyRow
		if err := rows.Scan(&item.kind, &item.provider, &item.baseURL, &item.model, &item.transport, &item.nonce, &item.ciphertext, &item.validationStatus, &item.validationCode, &item.validationMessage, &item.dimensions, &item.validatedAt, &item.validatedBy, &item.updatedAt, &item.updatedBy); err != nil {
			_ = rows.Close()
			return err
		}
		items = append(items, item)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, item := range items {
		name := ConfigPrimaryAgent
		switch item.kind {
		case "llm":
		case "embedding":
			name = ConfigCampusDocsEmbedding
		case "notice_classifier":
			name = ConfigNoticeClassification
		default:
			return fmt.Errorf("unsupported legacy model kind %q", item.kind)
		}
		if item.validationStatus != "passed" {
			return fmt.Errorf("legacy model setting %s is not validated", item.kind)
		}
		plain, err := legacy.Decrypt(item.nonce, item.ciphertext, "execution_config.model_settings:"+item.kind)
		if err != nil {
			return fmt.Errorf("decrypt legacy %s: %w", item.kind, err)
		}
		protocol := item.transport
		switch item.transport {
		case "responses":
			protocol = "openai.responses"
		case "chat_completions":
			protocol = "openai.chat_completions"
		case "embeddings":
			protocol = "openai.embeddings"
		}
		target := Target{Name: name, Provider: item.provider, APIProtocol: protocol, BaseURL: item.baseURL, Model: item.model}
		baseURL, err := NormalizeBaseURL(target.BaseURL)
		if err != nil {
			return err
		}
		target.BaseURL = baseURL
		if name == ConfigCampusDocsEmbedding {
			target.Provider = "openai-compatible"
			target.APIProtocol = "openai.embeddings"
			target.Model = embeddingModel
		}
		if err := validateShape(target, plain); err != nil {
			return fmt.Errorf("legacy model setting %s is invalid: %w", item.kind, err)
		}
		encrypted, err := current.EncryptValue(plain, configAAD(name))
		if err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `insert into model_config.model_configs(name,provider,api_protocol,base_url,model,encrypted_api_key,validation_status,validation_error_code,validation_message,validation_observed_dimensions,validated_at,validated_by,updated_at,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,nullif($10,0),$11,$12,$13,$14) on conflict(name) do nothing`, name, target.Provider, target.APIProtocol, target.BaseURL, target.Model, encrypted, item.validationStatus, item.validationCode, item.validationMessage, item.dimensions, item.validatedAt, item.validatedBy, item.updatedAt, item.updatedBy)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			var provider, apiProtocol, existingBaseURL, model string
			if err := tx.QueryRowContext(ctx, `select provider,api_protocol,base_url,model from model_config.model_configs where name=$1`, name).Scan(&provider, &apiProtocol, &existingBaseURL, &model); err != nil {
				return err
			}
			if provider != target.Provider || apiProtocol != target.APIProtocol || existingBaseURL != target.BaseURL || model != target.Model {
				return fmt.Errorf("legacy model setting %s conflicts with existing model_config config", item.kind)
			}
		}
	}
	if _, err := tx.ExecContext(ctx, `drop view if exists execution_config.model_settings`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `drop table if exists execution_control.model_settings`); err != nil {
		return err
	}
	return nil
}
