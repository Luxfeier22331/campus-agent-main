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
	defer func() { _ = db.Close() }()
	if err := db.PingContext(ctx); err != nil {
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
	if err := checkColumns(ctx, tx); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `create table if not exists model_config.schema_migrations(version integer primary key, applied_at timestamptz not null)`); err != nil {
		return err
	}
	if err := migrateLegacyModelSettings(ctx, tx, legacyCipher, newCipher); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `insert into model_config.schema_migrations(version,applied_at) values($1,$2) on conflict(version) do nothing`, migrationVersion, time.Now().UTC()); err != nil {
		return err
	}
	var roleExists bool
	if err = tx.QueryRowContext(ctx, `select exists(select 1 from pg_roles where rolname='model_config')`).Scan(&roleExists); err != nil {
		return err
	}
	if !roleExists {
		return errors.New("database role model_config is not installed")
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
	return tx.Commit()
}

func checkColumns(ctx context.Context, tx *sql.Tx) error {
	rows, err := tx.QueryContext(ctx, `select column_name from information_schema.columns where table_schema='model_config' and table_name='model_configs' order by ordinal_position`)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	want := []string{
		"name",
		"provider",
		"api_protocol",
		"base_url",
		"model",
		"encrypted_api_key",
		"validation_status",
		"validation_error_code",
		"validation_message",
		"validation_observed_dimensions",
		"validated_at",
		"validated_by",
		"updated_at",
		"updated_by",
	}
	got := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return err
		}
		got = append(got, name)
	}
	if len(got) != len(want) {
		return fmt.Errorf("model_config.model_configs has unexpected columns: %v", got)
	}
	for index := range want {
		if got[index] != want[index] {
			return fmt.Errorf("model_config.model_configs has unexpected columns: %v", got)
		}
	}
	return rows.Err()
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
