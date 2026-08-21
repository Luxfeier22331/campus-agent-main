package providerconfig

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrInitialAPIKeyRequired = errors.New("api key is required for the initial model setting")
	ErrNotConfigured         = errors.New("model settings store is not configured")
	ErrNotFound              = errors.New("model setting not found")
)

type Store struct {
	cipher *SecretCipher
	pool   *pgxpool.Pool
}

func NewStore(ctx context.Context, databaseURL string, cipher *SecretCipher) (*Store, error) {
	if strings.TrimSpace(databaseURL) == "" || cipher == nil {
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
	return &Store{cipher: cipher, pool: pool}, nil
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
	var retiredSecretColumnsExist bool
	if err := pool.QueryRow(ctx, `select exists(
		select 1 from information_schema.columns
		where table_schema='execution_control' and table_name='model_settings'
		  and column_name in ('secret_key_id','secret_fingerprint','secret_last4')
	)`).Scan(&retiredSecretColumnsExist); err != nil {
		return err
	}
	if retiredSecretColumnsExist {
		return errors.New("retired model settings secret columns are still installed")
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
	if s == nil || s.pool == nil || s.cipher == nil {
		return ErrNotConfigured
	}
	for _, kind := range []Kind{KindLLM, KindEmbedding} {
		setting, err := s.Resolve(ctx, kind)
		if err != nil {
			return err
		}
		if err := ValidateRuntimeSetting(setting, kind); err != nil {
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

func (s *Store) StoredSecretsCheck(ctx context.Context) error {
	if s == nil || s.pool == nil || s.cipher == nil {
		return ErrNotConfigured
	}
	rows, err := s.pool.Query(ctx, `select kind,secret_nonce,secret_ciphertext
		from execution_control.model_settings order by kind`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var kind Kind
		var nonce, ciphertext []byte
		if err := rows.Scan(&kind, &nonce, &ciphertext); err != nil {
			return err
		}
		if _, err := s.cipher.Decrypt(nonce, ciphertext, settingAAD(kind)); err != nil {
			return fmt.Errorf("decrypt stored %s model setting: %w", kind, err)
		}
	}
	return rows.Err()
}

func (s *Store) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}

func (s *Store) Resolve(ctx context.Context, kind Kind) (RuntimeSetting, error) {
	var setting RuntimeSetting
	var nonce, ciphertext []byte
	err := s.pool.QueryRow(ctx, `select kind,provider,base_url,model,transport,
		secret_nonce,secret_ciphertext
		from execution_control.model_settings where kind=$1`, kind).Scan(
		&setting.Kind,
		&setting.Provider,
		&setting.BaseURL,
		&setting.Model,
		&setting.Transport,
		&nonce,
		&ciphertext,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return RuntimeSetting{}, fmt.Errorf("%w: %s", ErrNotFound, kind)
	}
	if err != nil {
		return RuntimeSetting{}, err
	}
	setting.APIKey, err = s.cipher.Decrypt(nonce, ciphertext, settingAAD(kind))
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
	if candidate.Kind == KindEmbedding {
		candidate.Model = CanonicalEmbeddingModel
		candidate.Provider = CanonicalEmbeddingProvider
		candidate.Transport = CanonicalEmbeddingTransport
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
	candidate RuntimeSetting,
	validation ValidationResult,
) (Status, error) {
	if err := ValidateRuntimeSetting(candidate, candidate.Kind); err != nil {
		return Status{}, err
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Status{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := lockModelSettings(ctx, tx); err != nil {
		return Status{}, err
	}
	secret, err := s.cipher.Encrypt(candidate.APIKey, settingAAD(candidate.Kind))
	if err != nil {
		return Status{}, err
	}
	now := time.Now().UTC()
	_, err = tx.Exec(ctx, `insert into execution_control.model_settings
		(kind,provider,base_url,model,transport,
		 secret_nonce,secret_ciphertext,
		 validation_status,validation_error_code,validation_message,validation_observed_dimensions,
		 validated_at,validated_by,updated_at,updated_by)
		 values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,nullif($11,0),$12,$13,$12,$13)
		 on conflict(kind) do update set
		 provider=excluded.provider,base_url=excluded.base_url,model=excluded.model,
		 transport=excluded.transport,
		 secret_nonce=excluded.secret_nonce,secret_ciphertext=excluded.secret_ciphertext,
		 validation_status=excluded.validation_status,
		 validation_error_code=excluded.validation_error_code,validation_message=excluded.validation_message,
		 validation_observed_dimensions=excluded.validation_observed_dimensions,
		 validated_at=excluded.validated_at,validated_by=excluded.validated_by,
		 updated_at=excluded.updated_at,updated_by=excluded.updated_by`,
		candidate.Kind,
		candidate.Provider,
		candidate.BaseURL,
		candidate.Model,
		candidate.Transport,
		secret.Nonce,
		secret.Ciphertext,
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

func (s *Store) Status(ctx context.Context) (Status, error) {
	status := Status{
		EmbeddingContract: CanonicalEmbeddingContract(),
		SampledAt:         time.Now().UTC(),
		Settings: map[Kind]*SettingView{
			KindLLM:              nil,
			KindEmbedding:        nil,
			KindNoticeClassifier: nil,
		},
	}
	rows, err := s.pool.Query(ctx, `select kind,provider,base_url,model,transport,
		(length(secret_ciphertext) > 0),validation_status,validation_error_code,validation_message,
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
			&view.CredentialConfigured,
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
		validation.ValidatedAt = validation.ValidatedAt.UTC()
		view.UpdatedAt = view.UpdatedAt.UTC()
		if view.Kind == KindEmbedding {
			view.Model = CanonicalEmbeddingModel
			view.Provider = CanonicalEmbeddingProvider
			view.Transport = CanonicalEmbeddingTransport
		}
		view.LatestValidation = &validation
		status.Settings[view.Kind] = &view
	}
	if err := rows.Err(); err != nil {
		return Status{}, err
	}
	return status, nil
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
