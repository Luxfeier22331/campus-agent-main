package providerconfig

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrConflict              = errors.New("model settings changed")
	ErrInitialAPIKeyRequired = errors.New("api key is required for the initial model setting")
	ErrNotConfigured         = errors.New("model settings store is not configured")
	ErrNotFound              = errors.New("model setting not found")
)

type Store struct {
	keyring *Keyring
	pool    *pgxpool.Pool
}

func NewStore(ctx context.Context, databaseURL string, keyring *Keyring) (*Store, error) {
	if strings.TrimSpace(databaseURL) == "" || keyring == nil {
		return nil, ErrNotConfigured
	}
	config, err := pgxpool.ParseConfig(strings.TrimSpace(databaseURL))
	if err != nil {
		return nil, fmt.Errorf("parse model settings database url: %w", err)
	}
	config.MaxConns = 6
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("create model settings pool: %w", err)
	}
	return &Store{keyring: keyring, pool: pool}, nil
}

type databaseRoleQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func lockModelSettings(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1,0))`, modelSettingsLockName)
	return err
}

func CheckDatabaseSchema(ctx context.Context, databaseURL string) error {
	pool, err := pgxpool.New(ctx, strings.TrimSpace(databaseURL))
	if err != nil {
		return err
	}
	defer pool.Close()
	var exists bool
	if err := pool.QueryRow(ctx, "select to_regclass('execution_control.model_settings') is not null").Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return errors.New("execution_control.model_settings table is not installed")
	}
	var retiredTimeoutColumnExists bool
	if err := pool.QueryRow(ctx, `select exists(
		select 1 from information_schema.columns
		where table_schema='execution_control' and table_name='model_settings' and column_name='timeout_ms'
	)`).Scan(&retiredTimeoutColumnExists); err != nil {
		return err
	}
	if retiredTimeoutColumnExists {
		return errors.New("retired execution_control.model_settings.timeout_ms column is still installed")
	}
	var retiredVectorColumnsExist bool
	if err := pool.QueryRow(ctx, `select exists(
		select 1 from information_schema.columns
		where table_schema='execution_control' and table_name='model_settings'
		  and column_name in ('dimensions','embedding_space_id')
	)`).Scan(&retiredVectorColumnsExist); err != nil {
		return err
	}
	if retiredVectorColumnsExist {
		return errors.New("retired model settings vector columns are still installed")
	}
	legacyTables, err := legacyProviderConfigTablePresence(ctx, pool)
	if err != nil {
		return err
	}
	if anyTrue(legacyTables) {
		return errors.New("legacy provider config schema is still installed")
	}
	checks := []struct {
		privilege string
		role      string
		want      bool
	}{
		{privilege: "SELECT", role: "execution_control", want: true},
		{privilege: "INSERT", role: "execution_control", want: true},
		{privilege: "UPDATE", role: "execution_control", want: true},
		{privilege: "DELETE", role: "execution_control", want: true},
	}
	for _, check := range checks {
		var granted bool
		if err := pool.QueryRow(ctx, "select has_table_privilege($1,'execution_control.model_settings',$2)", check.role, check.privilege).Scan(&granted); err != nil {
			return err
		}
		if granted != check.want {
			return fmt.Errorf("database role %s %s on execution_control.model_settings = %t, want %t", check.role, check.privilege, granted, check.want)
		}
	}
	return nil
}

func (s *Store) HealthCheck(ctx context.Context) error {
	if s == nil || s.pool == nil || s.keyring == nil {
		return ErrNotConfigured
	}
	for _, kind := range []Kind{KindLLM, KindEmbedding} {
		if _, err := s.Resolve(ctx, kind); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) AdminReadinessCheck(ctx context.Context) error {
	if s == nil || s.pool == nil {
		return ErrNotConfigured
	}
	var ready bool
	if err := s.pool.QueryRow(ctx, "select to_regclass('execution_control.model_settings') is not null").Scan(&ready); err != nil {
		return err
	}
	if !ready {
		return errors.New("model settings schema is not installed")
	}
	return nil
}

func (s *Store) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}

func (s *Store) Resolve(ctx context.Context, kind Kind) (RuntimeSetting, error) {
	var setting RuntimeSetting
	var keyID string
	var nonce, ciphertext []byte
	err := s.pool.QueryRow(ctx, `select kind,provider,base_url,model,transport,
		secret_key_id,secret_nonce,secret_ciphertext
		from execution_control.model_settings where kind=$1`, kind).Scan(
		&setting.Kind,
		&setting.Provider,
		&setting.BaseURL,
		&setting.Model,
		&setting.Transport,
		&keyID,
		&nonce,
		&ciphertext,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return RuntimeSetting{}, fmt.Errorf("%w: %s", ErrNotFound, kind)
	}
	if err != nil {
		return RuntimeSetting{}, err
	}
	setting.APIKey, err = s.keyring.Decrypt(keyID, nonce, ciphertext, settingAAD(kind))
	if err != nil {
		return RuntimeSetting{}, err
	}
	return setting, nil
}

func (s *Store) Candidate(ctx context.Context, input SettingInput) (RuntimeSetting, error) {
	candidate := RuntimeSetting{
		APIKey:    strings.TrimSpace(input.APIKey),
		BaseURL:   strings.TrimRight(strings.TrimSpace(input.BaseURL), "/"),
		Kind:      input.Kind,
		Model:     strings.TrimSpace(input.Model),
		Provider:  strings.TrimSpace(input.Provider),
		Transport: strings.TrimSpace(input.Transport),
	}
	if candidate.APIKey != "" {
		return candidate, nil
	}
	current, err := s.Resolve(ctx, input.Kind)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return RuntimeSetting{}, ErrInitialAPIKeyRequired
		}
		return RuntimeSetting{}, err
	}
	candidate.APIKey = current.APIKey
	return candidate, nil
}

func (s *Store) Put(
	ctx context.Context,
	actor string,
	expectedETag string,
	candidate RuntimeSetting,
	validation ValidationResult,
) (Status, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Status{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := lockModelSettings(ctx, tx); err != nil {
		return Status{}, err
	}
	currentETag, err := statusETagTx(ctx, tx)
	if err != nil {
		return Status{}, err
	}
	if normalizeETag(expectedETag) != currentETag {
		return Status{}, ErrConflict
	}
	secret, err := s.keyring.Encrypt(candidate.APIKey, settingAAD(candidate.Kind))
	if err != nil {
		return Status{}, err
	}
	now := time.Now().UTC()
	_, err = tx.Exec(ctx, `insert into execution_control.model_settings
		(kind,provider,base_url,model,transport,
		 secret_key_id,secret_nonce,secret_ciphertext,secret_fingerprint,secret_last4,
		 validation_status,validation_error_code,validation_message,validation_observed_dimensions,
		 validated_at,validated_by,updated_at,updated_by)
		 values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,nullif($14,0),$15,$16,$15,$16)
		 on conflict(kind) do update set
		 provider=excluded.provider,base_url=excluded.base_url,model=excluded.model,
		 transport=excluded.transport,
		 secret_key_id=excluded.secret_key_id,secret_nonce=excluded.secret_nonce,
		 secret_ciphertext=excluded.secret_ciphertext,secret_fingerprint=excluded.secret_fingerprint,
		 secret_last4=excluded.secret_last4,validation_status=excluded.validation_status,
		 validation_error_code=excluded.validation_error_code,validation_message=excluded.validation_message,
		 validation_observed_dimensions=excluded.validation_observed_dimensions,
		 validated_at=excluded.validated_at,validated_by=excluded.validated_by,
		 updated_at=excluded.updated_at,updated_by=excluded.updated_by`,
		candidate.Kind,
		candidate.Provider,
		candidate.BaseURL,
		candidate.Model,
		candidate.Transport,
		secret.KeyID,
		secret.Nonce,
		secret.Ciphertext,
		secret.Fingerprint,
		secret.Last4,
		validation.Status,
		validation.ErrorCode,
		validation.Message,
		validation.ObservedDimensions,
		now,
		normalizeActor(actor),
	)
	if err != nil {
		return Status{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Status{}, err
	}
	return s.Status(ctx)
}

func (s *Store) RecordValidation(
	ctx context.Context,
	actor string,
	kind Kind,
	result ValidationResult,
	expectedUpdatedAt time.Time,
) error {
	command, err := s.pool.Exec(ctx, `update execution_control.model_settings set
		validation_status=$2,validation_error_code=$3,validation_message=$4,
		validation_observed_dimensions=nullif($5,0),validated_at=$6,validated_by=$7
		where kind=$1 and updated_at=$8`, kind, result.Status, result.ErrorCode, result.Message, result.ObservedDimensions, time.Now().UTC(), normalizeActor(actor), expectedUpdatedAt)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return fmt.Errorf("%w: %s", ErrConflict, kind)
	}
	return nil
}

func (s *Store) Status(ctx context.Context) (Status, error) {
	status := Status{
		SampledAt: time.Now().UTC(),
		Settings: map[Kind]*SettingView{
			KindLLM:       nil,
			KindEmbedding: nil,
		},
	}
	rows, err := s.pool.Query(ctx, `select kind,provider,base_url,model,transport,
		secret_last4,validation_status,validation_error_code,validation_message,
		coalesce(validation_observed_dimensions,0),validated_at,validated_by,updated_at,updated_by
		from execution_control.model_settings order by kind`)
	if err != nil {
		return Status{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var view SettingView
		var validation LatestValidationView
		if err := rows.Scan(
			&view.Kind,
			&view.Provider,
			&view.BaseURL,
			&view.Model,
			&view.Transport,
			&view.CredentialLast4,
			&validation.Status,
			&validation.ErrorCode,
			&validation.Message,
			&validation.ObservedDimensions,
			&validation.ValidatedAt,
			&validation.ValidatedBy,
			&view.UpdatedAt,
			&view.UpdatedBy,
		); err != nil {
			return Status{}, err
		}
		view.CredentialConfigured = view.CredentialLast4 != ""
		view.LatestValidation = &validation
		status.Settings[view.Kind] = &view
	}
	if err := rows.Err(); err != nil {
		return Status{}, err
	}
	status.ETag = statusETag(status.Settings)
	return status, nil
}

func statusETagTx(ctx context.Context, tx pgx.Tx) (string, error) {
	rows, err := tx.Query(ctx, "select kind,updated_at from execution_control.model_settings order by kind")
	if err != nil {
		return "", err
	}
	defer rows.Close()
	settings := map[Kind]*SettingView{}
	for rows.Next() {
		var kind Kind
		var updatedAt time.Time
		if err := rows.Scan(&kind, &updatedAt); err != nil {
			return "", err
		}
		settings[kind] = &SettingView{Kind: kind, UpdatedAt: updatedAt}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	return statusETag(settings), nil
}

func statusETag(settings map[Kind]*SettingView) string {
	kinds := make([]string, 0, len(settings))
	for kind, setting := range settings {
		if setting != nil {
			kinds = append(kinds, string(kind))
		}
	}
	sort.Strings(kinds)
	var source strings.Builder
	for _, rawKind := range kinds {
		kind := Kind(rawKind)
		setting := settings[kind]
		source.WriteString(rawKind)
		source.WriteByte(':')
		source.WriteString(setting.UpdatedAt.UTC().Format(time.RFC3339Nano))
		source.WriteByte('\n')
	}
	sum := sha256.Sum256([]byte(source.String()))
	return hex.EncodeToString(sum[:])
}

func normalizeETag(value string) string {
	return strings.Trim(strings.TrimSpace(value), "\"")
}

func normalizeActor(actor string) string {
	actor = strings.TrimSpace(actor)
	if actor == "" {
		return "execution-control-admin"
	}
	if len(actor) > 256 {
		return actor[:256]
	}
	return actor
}

func settingAAD(kind Kind) string {
	return "execution_config.model_settings:" + string(kind)
}
