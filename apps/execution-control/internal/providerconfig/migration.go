package providerconfig

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func legacyConnectionAAD(connectionID string, revision int64) string {
	return fmt.Sprintf("execution_config.connection:%s:%d", connectionID, revision)
}

const (
	canonicalEmbeddingModel      = "Qwen3-Embedding-4B"
	canonicalEmbeddingDimensions = 2560
	modelSettingsLockName        = "execution_config.model_settings"
)

var legacyProviderConfigTables = []string{
	"execution_config.active_bundle",
	"execution_config.activation_bundles",
	"execution_config.profile_validations",
	"execution_config.profiles",
	"execution_config.connection_revisions",
	"execution_config.command_receipts",
	"execution_config.audit_events",
}

var legacyProviderConfigDropStatements = []string{
	"drop table execution_config.active_bundle",
	"drop table execution_config.profile_validations",
	"drop table execution_config.profiles",
	"drop table execution_config.connection_revisions",
	"drop table execution_config.activation_bundles",
	"drop table execution_config.command_receipts",
	"drop table execution_config.audit_events",
}

// InstallDatabaseSchema installs the current schema. If the previous provider
// schema is present, its active settings are migrated and the old tables are
// removed in the same transaction.
func InstallDatabaseSchema(ctx context.Context, databaseURL string, keyring *Keyring) error {
	pool, err := pgxpool.New(ctx, strings.TrimSpace(databaseURL))
	if err != nil {
		return err
	}
	defer pool.Close()
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := ensureDatabaseRoles(ctx, tx); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, SchemaSQL); err != nil {
		return err
	}
	if err := lockModelSettings(ctx, tx); err != nil {
		return err
	}
	if err := migrateAndRemoveLegacyModelSettings(ctx, tx, keyring); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, GrantSQL); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func migrateAndRemoveLegacyModelSettings(ctx context.Context, tx pgx.Tx, keyring *Keyring) error {
	present, err := legacyProviderConfigTablePresence(ctx, tx)
	if err != nil {
		return err
	}
	if !anyTrue(present) {
		return nil
	}
	if !allTrue(present) {
		return errors.New("legacy provider config schema is incomplete")
	}
	count, err := currentModelSettingsCount(ctx, tx)
	if err != nil {
		return err
	}
	if count != 0 {
		return errors.New("current model settings must be empty before legacy provider config migration")
	}
	if keyring == nil {
		return errors.New("provider config migration requires keyring")
	}
	var profilesJSON []byte
	var activatedAt time.Time
	var activatedBy string
	err = tx.QueryRow(ctx, `select b.profiles_json,b.activated_at,b.activated_by
		from execution_config.active_bundle a
		join execution_config.activation_bundles b on b.bundle_id=a.bundle_id
		where a.singleton=true and a.revision=b.revision`).Scan(&profilesJSON, &activatedAt, &activatedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return errors.New("legacy provider config active bundle is missing")
	}
	if err != nil {
		return err
	}
	var profileIDs map[string]string
	if err := json.Unmarshal(profilesJSON, &profileIDs); err != nil {
		return fmt.Errorf("decode legacy active provider bundle: %w", err)
	}
	for _, role := range []string{"primary_agent", "rag_query_embedding"} {
		profileID := strings.TrimSpace(profileIDs[role])
		if profileID == "" {
			return fmt.Errorf("legacy active provider bundle is missing %s", role)
		}
		if err := migrateLegacyProfile(ctx, tx, keyring, role, profileID, activatedAt, activatedBy); err != nil {
			return err
		}
	}
	count, err = currentModelSettingsCount(ctx, tx)
	if err != nil {
		return err
	}
	if count != 2 {
		return fmt.Errorf("migrated model settings count = %d, want 2", count)
	}
	for _, statement := range legacyProviderConfigDropStatements {
		if _, err := tx.Exec(ctx, statement); err != nil {
			return fmt.Errorf("remove legacy provider config schema: %w", err)
		}
	}
	return nil
}

func lockModelSettings(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1,0))`, modelSettingsLockName)
	return err
}

func currentModelSettingsCount(ctx context.Context, tx pgx.Tx) (int, error) {
	var count int
	if err := tx.QueryRow(ctx, "select count(*) from execution_config.model_settings").Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func legacyProviderConfigTablePresence(ctx context.Context, querier databaseRoleQuerier) ([]bool, error) {
	present := make([]bool, len(legacyProviderConfigTables))
	for index, table := range legacyProviderConfigTables {
		if err := querier.QueryRow(ctx, `select to_regclass($1) is not null`, table).Scan(&present[index]); err != nil {
			return nil, err
		}
	}
	return present, nil
}

func anyTrue(values []bool) bool {
	for _, value := range values {
		if value {
			return true
		}
	}
	return false
}

func allTrue(values []bool) bool {
	for _, value := range values {
		if !value {
			return false
		}
	}
	return true
}

func migrateLegacyProfile(ctx context.Context, tx pgx.Tx, keyring *Keyring, role, profileID string, activatedAt time.Time, activatedBy string) error {
	var (
		storedRole, kind, model, transport, connectionID, provider, baseURL string
		dimensions                                                          int
		revision                                                            int64
		nonce, ciphertext                                                   []byte
		keyID, validationStatus, validationCode, validationMsg              string
		observedDimensions                                                  int
		validatedAt                                                         time.Time
		validatedBy                                                         string
	)
	err := tx.QueryRow(ctx, `select p.role,p.kind,p.model,p.transport,coalesce(p.dimensions,0),
		p.connection_id,p.connection_revision,c.provider,c.base_url,c.secret_key_id,c.secret_nonce,c.secret_ciphertext,
		coalesce(v.status,''),coalesce(v.error_code,''),coalesce(v.message,''),coalesce(v.observed_dimensions,0),
		coalesce(v.validated_at,$2::timestamptz),coalesce(v.validated_by,$3::text)
		from execution_config.profiles p
		join execution_config.connection_revisions c on c.connection_id=p.connection_id and c.revision=p.connection_revision
		left join lateral (select status,error_code,message,observed_dimensions,validated_at,validated_by
			from execution_config.profile_validations
			where profile_id=p.profile_id and validated_at <= $2
			order by validated_at desc limit 1) v on true
		where p.profile_id=$1`, profileID, activatedAt, activatedBy).Scan(
		&storedRole, &kind, &model, &transport, &dimensions, &connectionID, &revision,
		&provider, &baseURL, &keyID, &nonce, &ciphertext, &validationStatus, &validationCode,
		&validationMsg, &observedDimensions, &validatedAt, &validatedBy,
	)
	if err != nil {
		return fmt.Errorf("read legacy provider profile %s: %w", profileID, err)
	}
	if storedRole != role || (role == "primary_agent" && kind != "prompt") || (role == "rag_query_embedding" && (kind != "embedding" || model != canonicalEmbeddingModel || dimensions != canonicalEmbeddingDimensions || transport != "embeddings")) {
		return fmt.Errorf("legacy provider profile %s does not match %s", profileID, role)
	}
	if validationStatus != "passed" {
		return fmt.Errorf("legacy provider profile %s is not validated", profileID)
	}
	plain, err := keyring.Decrypt(keyID, nonce, ciphertext, legacyConnectionAAD(connectionID, revision))
	if err != nil {
		return fmt.Errorf("decrypt legacy provider profile %s: %w", profileID, err)
	}
	newKind := KindLLM
	newTransport := transport
	if role == "rag_query_embedding" {
		newKind = KindEmbedding
		newTransport = "embeddings"
		dimensions = canonicalEmbeddingDimensions
	}
	candidate := RuntimeSetting{
		APIKey:     plain,
		BaseURL:    baseURL,
		Dimensions: dimensions,
		Kind:       newKind,
		Model:      model,
		Provider:   provider,
		Transport:  newTransport,
	}
	if err := validateSettingShape(candidate); err != nil {
		return fmt.Errorf("validate migrated provider profile %s: %w", profileID, err)
	}
	secret, err := keyring.Encrypt(plain, settingAAD(newKind))
	if err != nil {
		return fmt.Errorf("encrypt migrated provider profile %s: %w", profileID, err)
	}
	_, err = tx.Exec(ctx, `insert into execution_config.model_settings
		(kind,provider,base_url,model,transport,dimensions,secret_key_id,secret_nonce,secret_ciphertext,
		 secret_fingerprint,secret_last4,validation_status,validation_error_code,validation_message,
		 validation_observed_dimensions,validated_at,validated_by,updated_at,updated_by)
		values($1,$2,$3,$4,$5,nullif($6,0),$7,$8,$9,$10,$11,$12,$13,$14,nullif($15,0),$16,$17,$16,$17)
		`, newKind, provider, baseURL, model, newTransport, dimensions,
		secret.KeyID, secret.Nonce, secret.Ciphertext, secret.Fingerprint, secret.Last4, validationStatus,
		validationCode, validationMsg, observedDimensions, validatedAt, validatedBy)
	return err
}
