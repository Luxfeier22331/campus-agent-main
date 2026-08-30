package modelconfig

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("model config not found")
var ErrInitialAPIKeyRequired = errors.New("api key is required for the initial model config")
var ErrTargetMismatch = errors.New("model target hash mismatch")
var ErrLocalSeedRequiresConfig = errors.New("at least one model config is required for local seed")
var ErrLocalCheckRequiresConfig = errors.New("at least one model config is required for local check")

const maxPoolConns = 4

type Store struct {
	pool   *pgxpool.Pool
	cipher *Cipher
}

type rowScanner interface {
	Scan(dest ...any) error
}

type LocalSeedConfig struct {
	Name        ConfigName
	APIKey      string
	Provider    string
	APIProtocol string
	BaseURL     string
	Model       string
}

type LocalConfigCheckState string

const (
	LocalConfigCheckMissing LocalConfigCheckState = "missing"
	LocalConfigCheckInvalid LocalConfigCheckState = "invalid"
	LocalConfigCheckReady   LocalConfigCheckState = "ready"
	LocalConfigCheckUnknown LocalConfigCheckState = "unknown"
)

type LocalConfigCheck struct {
	Name   ConfigName            `json:"name"`
	State  LocalConfigCheckState `json:"state"`
	Reason string                `json:"reason,omitempty"`
}

func NewStore(ctx context.Context, databaseURL string, cipher *Cipher) (*Store, error) {
	if strings.TrimSpace(databaseURL) == "" || cipher == nil {
		return nil, errors.New("model config store is not configured")
	}
	config, err := pgxpool.ParseConfig(strings.TrimSpace(databaseURL))
	if err != nil {
		return nil, fmt.Errorf("parse model config database URL: %w", err)
	}
	config.MaxConns = maxPoolConns
	config.MinConns = 0
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("create model config pool: %w", err)
	}
	return &Store{pool: pool, cipher: cipher}, nil
}

func (s *Store) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}

// Readiness proves that the owned table is queryable and every stored provider
// credential can be decrypted. It deliberately does not contact providers.
func (s *Store) Readiness(ctx context.Context) error {
	if s == nil || s.pool == nil || s.cipher == nil {
		return errors.New("model config store is not configured")
	}
	rows, err := s.pool.Query(ctx, `select name,encrypted_api_key from model_config.model_configs order by name`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var name ConfigName
		var encrypted []byte
		if err := rows.Scan(&name, &encrypted); err != nil {
			return err
		}
		if _, err := s.cipher.DecryptValue(encrypted, configAAD(name)); err != nil {
			return fmt.Errorf("decrypt stored model config %s: %w", name, err)
		}
	}
	return rows.Err()
}

func configAAD(name ConfigName) string {
	return "model_config.model_configs:v1:" + string(name)
}

func (s *Store) Descriptor(ctx context.Context, name ConfigName) (Descriptor, error) {
	var descriptor Descriptor
	err := s.pool.QueryRow(ctx, `select name,provider,api_protocol,base_url,model from model_config.model_configs where name=$1`, name).Scan(
		&descriptor.Name,
		&descriptor.Provider,
		&descriptor.APIProtocol,
		&descriptor.BaseURL,
		&descriptor.Model,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Descriptor{}, fmt.Errorf("%w: %s", ErrNotFound, name)
	}
	if err != nil {
		return Descriptor{}, err
	}
	descriptor.SchemaVersion = "model_target.v1"
	descriptor.TargetSHA256 = TargetHash(descriptor.Target)
	return descriptor, nil
}

func (s *Store) Resolve(ctx context.Context, name ConfigName, expected string) (RuntimeConfig, error) {
	var target Target
	var encrypted []byte
	err := s.pool.QueryRow(ctx, `select name,provider,api_protocol,base_url,model,encrypted_api_key from model_config.model_configs where name=$1`, name).Scan(
		&target.Name,
		&target.Provider,
		&target.APIProtocol,
		&target.BaseURL,
		&target.Model,
		&encrypted,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return RuntimeConfig{}, fmt.Errorf("%w: %s", ErrNotFound, name)
	}
	if err != nil {
		return RuntimeConfig{}, err
	}
	targetSHA256 := TargetHash(target)
	if expected != "" && expected != targetSHA256 {
		return RuntimeConfig{}, ErrTargetMismatch
	}
	apiKey, err := s.cipher.DecryptValue(encrypted, configAAD(name))
	if err != nil {
		return RuntimeConfig{}, err
	}
	return RuntimeConfig{
		SchemaVersion: "model_runtime_config.v1",
		Target:        target,
		APIKey:        apiKey,
		TargetSHA256:  targetSHA256,
	}, nil
}

func (s *Store) Status(ctx context.Context) (Status, error) {
	status := Status{
		SchemaVersion: "model_config_status.v1",
		SampledAt:     time.Now().UTC(),
		Configs:       map[ConfigName]*ConfigView{},
	}
	rows, err := s.pool.Query(ctx, `select name,provider,api_protocol,base_url,model,(length(encrypted_api_key)>0),validation_status,validation_error_code,validation_message,coalesce(validation_observed_dimensions,0),validated_at,validated_by,updated_at,updated_by from model_config.model_configs order by name`)
	if err != nil {
		return Status{}, err
	}
	defer rows.Close()
	for rows.Next() {
		view, err := scanConfigView(rows)
		if err != nil {
			return Status{}, err
		}
		status.Configs[view.Name] = &view
	}
	return status, rows.Err()
}

func (s *Store) Seed(ctx context.Context, configs []LocalSeedConfig) error {
	if s == nil || s.pool == nil || s.cipher == nil {
		return errors.New("model config store is not configured")
	}
	if len(configs) == 0 {
		return ErrLocalSeedRequiresConfig
	}

	type preparedConfig struct {
		LocalSeedConfig
		encrypted []byte
	}
	prepared := make([]preparedConfig, 0, len(configs))
	seen := make(map[ConfigName]struct{}, len(configs))
	for _, config := range configs {
		if _, exists := seen[config.Name]; exists {
			return fmt.Errorf("duplicate local model config %q", config.Name)
		}
		seen[config.Name] = struct{}{}
		baseURL, err := NormalizeBaseURL(config.BaseURL)
		if err != nil {
			return fmt.Errorf("local model config %s: %w", config.Name, err)
		}
		target := Target{
			Name:        config.Name,
			Provider:    strings.TrimSpace(config.Provider),
			APIProtocol: strings.TrimSpace(config.APIProtocol),
			BaseURL:     baseURL,
			Model:       strings.TrimSpace(config.Model),
		}
		apiKey := strings.TrimSpace(config.APIKey)
		if err := validateShape(target, apiKey); err != nil {
			return fmt.Errorf("local model config %s: %w", config.Name, err)
		}
		encrypted, err := s.cipher.EncryptValue(apiKey, configAAD(target.Name))
		if err != nil {
			return fmt.Errorf("encrypt local model config %s: %w", config.Name, err)
		}
		prepared = append(prepared, preparedConfig{
			LocalSeedConfig: LocalSeedConfig{
				Name:        target.Name,
				APIKey:      apiKey,
				Provider:    target.Provider,
				APIProtocol: target.APIProtocol,
				BaseURL:     target.BaseURL,
				Model:       target.Model,
			},
			encrypted: encrypted,
		})
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	now := time.Now().UTC()
	for _, config := range prepared {
		if _, err := tx.Exec(ctx, `insert into model_config.model_configs(name,provider,api_protocol,base_url,model,encrypted_api_key,updated_at,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(name) do nothing`,
			config.Name,
			config.Provider,
			config.APIProtocol,
			config.BaseURL,
			config.Model,
			config.encrypted,
			now,
			"local-seed",
		); err != nil {
			return fmt.Errorf("seed local model config %s: %w", config.Name, err)
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) Check(ctx context.Context, names []ConfigName) ([]LocalConfigCheck, error) {
	if s == nil || s.pool == nil || s.cipher == nil {
		return nil, errors.New("model config store is not configured")
	}
	if len(names) == 0 {
		return nil, ErrLocalCheckRequiresConfig
	}
	checks := make([]LocalConfigCheck, 0, len(names))
	seen := make(map[ConfigName]struct{}, len(names))
	for _, name := range names {
		if _, exists := seen[name]; exists {
			return nil, fmt.Errorf("duplicate model config name %q", name)
		}
		seen[name] = struct{}{}
		var target Target
		var encrypted []byte
		err := s.pool.QueryRow(ctx, `select name,provider,api_protocol,base_url,model,encrypted_api_key from model_config.model_configs where name=$1`, name).Scan(
			&target.Name,
			&target.Provider,
			&target.APIProtocol,
			&target.BaseURL,
			&target.Model,
			&encrypted,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			checks = append(checks, LocalConfigCheck{Name: name, State: LocalConfigCheckMissing})
			continue
		}
		if err != nil {
			return nil, err
		}
		apiKey, err := s.cipher.DecryptValue(encrypted, configAAD(name))
		if err != nil {
			checks = append(checks, LocalConfigCheck{
				Name:   name,
				State:  LocalConfigCheckInvalid,
				Reason: "stored credential cannot be decrypted",
			})
			continue
		}
		baseURL, err := NormalizeBaseURL(target.BaseURL)
		if err != nil {
			checks = append(checks, LocalConfigCheck{Name: name, State: LocalConfigCheckInvalid, Reason: err.Error()})
			continue
		}
		target.BaseURL = baseURL
		if err := validateShape(target, apiKey); err != nil {
			checks = append(checks, LocalConfigCheck{Name: name, State: LocalConfigCheckInvalid, Reason: err.Error()})
			continue
		}
		checks = append(checks, LocalConfigCheck{Name: name, State: LocalConfigCheckReady})
	}
	return checks, nil
}

func (s *Store) Put(ctx context.Context, actor string, input ConfigInput, validation Validation) (ConfigView, error) {
	name := ConfigName(strings.TrimSpace(string(input.Name)))
	baseURL, err := NormalizeBaseURL(input.BaseURL)
	if err != nil {
		return ConfigView{}, err
	}
	apiKey := ""
	if input.APIKey != nil {
		apiKey = strings.TrimSpace(*input.APIKey)
	}
	if apiKey == "" {
		current, resolveErr := s.Resolve(ctx, name, "")
		if resolveErr != nil {
			if errors.Is(resolveErr, ErrNotFound) {
				return ConfigView{}, ErrInitialAPIKeyRequired
			}
			return ConfigView{}, resolveErr
		}
		apiKey = current.APIKey
	}
	if validation.Status != "passed" {
		return ConfigView{}, errors.New("model config must be validated before persistence")
	}
	target := Target{
		Name:        name,
		Provider:    strings.TrimSpace(input.Provider),
		APIProtocol: strings.TrimSpace(input.APIProtocol),
		BaseURL:     baseURL,
		Model:       strings.TrimSpace(input.Model),
	}
	if err := validateShape(target, apiKey); err != nil {
		return ConfigView{}, err
	}
	encrypted, err := s.cipher.EncryptValue(apiKey, configAAD(name))
	if err != nil {
		return ConfigView{}, err
	}
	now := time.Now().UTC()
	actor = validationActor(actor)
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ConfigView{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	view, err := scanConfigView(tx.QueryRow(ctx, `insert into model_config.model_configs(name,provider,api_protocol,base_url,model,encrypted_api_key,validation_status,validation_error_code,validation_message,validation_observed_dimensions,validated_at,validated_by,updated_at,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,nullif($10,0),$11,$12,$11,$12) on conflict(name) do update set provider=excluded.provider,api_protocol=excluded.api_protocol,base_url=excluded.base_url,model=excluded.model,encrypted_api_key=excluded.encrypted_api_key,validation_status=excluded.validation_status,validation_error_code=excluded.validation_error_code,validation_message=excluded.validation_message,validation_observed_dimensions=excluded.validation_observed_dimensions,validated_at=excluded.validated_at,validated_by=excluded.validated_by,updated_at=excluded.updated_at,updated_by=excluded.updated_by returning name,provider,api_protocol,base_url,model,(length(encrypted_api_key)>0),validation_status,validation_error_code,validation_message,coalesce(validation_observed_dimensions,0),validated_at,validated_by,updated_at,updated_by`,
		name,
		target.Provider,
		target.APIProtocol,
		target.BaseURL,
		target.Model,
		encrypted,
		validation.Status,
		validation.ErrorCode,
		validation.Message,
		validation.ObservedDimensions,
		now,
		actor,
	))
	if err != nil {
		return ConfigView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ConfigView{}, err
	}
	return view, nil
}

func (s *Store) RecordValidation(
	ctx context.Context,
	name ConfigName,
	actor string,
	validation Validation,
) (ConfigView, error) {
	if validation.Status != "passed" && validation.Status != "failed" {
		return ConfigView{}, errors.New("model config validation status is invalid")
	}
	view, err := scanConfigView(s.pool.QueryRow(ctx, `update model_config.model_configs set validation_status=$2,validation_error_code=$3,validation_message=$4,validation_observed_dimensions=nullif($5,0),validated_at=$6,validated_by=$7 where name=$1 returning name,provider,api_protocol,base_url,model,(length(encrypted_api_key)>0),validation_status,validation_error_code,validation_message,coalesce(validation_observed_dimensions,0),validated_at,validated_by,updated_at,updated_by`,
		name,
		validation.Status,
		validation.ErrorCode,
		validation.Message,
		validation.ObservedDimensions,
		time.Now().UTC(),
		validationActor(actor),
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return ConfigView{}, fmt.Errorf("%w: %s", ErrNotFound, name)
	}
	return view, err
}

func validationActor(actor string) string {
	actor = strings.TrimSpace(actor)
	if actor == "" {
		return "model-config"
	}
	return actor
}

func scanConfigView(scanner rowScanner) (ConfigView, error) {
	var view ConfigView
	var validationStatus, validationErrorCode, validationMessage sql.NullString
	var validatedAt sql.NullTime
	var validatedBy sql.NullString
	var observedDimensions int
	if err := scanner.Scan(
		&view.Name,
		&view.Provider,
		&view.APIProtocol,
		&view.BaseURL,
		&view.Model,
		&view.CredentialConfigured,
		&validationStatus,
		&validationErrorCode,
		&validationMessage,
		&observedDimensions,
		&validatedAt,
		&validatedBy,
		&view.UpdatedAt,
		&view.UpdatedBy,
	); err != nil {
		return ConfigView{}, err
	}
	if validationStatus.Valid && validationMessage.Valid && validatedAt.Valid && validatedBy.Valid {
		validation := &Validation{
			Status:             validationStatus.String,
			Message:            validationMessage.String,
			ObservedDimensions: observedDimensions,
		}
		if validationErrorCode.Valid {
			validation.ErrorCode = validationErrorCode.String
		}
		view.Validation = validation
		validatedAtValue := validatedAt.Time.UTC()
		view.ValidatedAt = &validatedAtValue
		validatedByValue := validatedBy.String
		view.ValidatedBy = &validatedByValue
	}
	view.UpdatedAt = view.UpdatedAt.UTC()
	view.SchemaVersion = "model_target.v1"
	view.TargetSHA256 = TargetHash(view.Target)
	return view, nil
}
