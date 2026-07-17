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

var (
	ErrConflict      = errors.New("provider config revision conflict")
	ErrNotConfigured = errors.New("provider config store is not configured")
	ErrNotFound      = errors.New("provider config record not found")
)

type Store struct {
	keyring *Keyring
	pool    *pgxpool.Pool
}

func commandReceiptMatches(existingOperation, existingHash, operation, requestHash string) bool {
	return existingOperation == operation && existingHash == requestHash
}

func readCommandReceiptTx(
	ctx context.Context,
	tx pgx.Tx,
	idempotencyKey string,
	operation string,
	requestHash string,
) ([]byte, int, bool, error) {
	var existingOperation string
	var existingHash string
	var existingStatus int
	var existingRaw []byte
	err := tx.QueryRow(
		ctx,
		`select operation,request_sha256,status_code,response_json from execution_config.command_receipts where idempotency_key=$1`,
		idempotencyKey,
	).Scan(&existingOperation, &existingHash, &existingStatus, &existingRaw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, 0, false, nil
	}
	if err != nil {
		return nil, 500, false, err
	}
	if !commandReceiptMatches(existingOperation, existingHash, operation, requestHash) {
		return nil, 409, false, ErrConflict
	}
	return existingRaw, existingStatus, true, nil
}

func writeCommandReceiptTx(
	ctx context.Context,
	tx pgx.Tx,
	idempotencyKey string,
	operation string,
	requestHash string,
	status int,
	response any,
	now time.Time,
) error {
	raw, err := json.Marshal(response)
	if err != nil {
		return err
	}
	_, err = tx.Exec(
		ctx,
		`insert into execution_config.command_receipts(idempotency_key,operation,request_sha256,status_code,response_json,created_at) values($1,$2,$3,$4,$5,$6)`,
		idempotencyKey,
		operation,
		requestHash,
		status,
		raw,
		now,
	)
	return err
}

func NewStore(ctx context.Context, databaseURL string, keyring *Keyring) (*Store, error) {
	if strings.TrimSpace(databaseURL) == "" || keyring == nil {
		return nil, ErrNotConfigured
	}
	config, err := pgxpool.ParseConfig(strings.TrimSpace(databaseURL))
	if err != nil {
		return nil, fmt.Errorf("parse provider config database url: %w", err)
	}
	config.MaxConns = 6
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("create provider config pool: %w", err)
	}
	return &Store{keyring: keyring, pool: pool}, nil
}

func EnsureDatabaseSchema(ctx context.Context, databaseURL string) error {
	pool, err := pgxpool.New(ctx, strings.TrimSpace(databaseURL))
	if err != nil {
		return err
	}
	defer pool.Close()
	for _, role := range []string{"execution_provider_config_reader", "execution_provider_config_admin"} {
		var exists bool
		if err := pool.QueryRow(ctx, "select exists(select 1 from pg_roles where rolname=$1)", role).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("database role %s is not installed", role)
		}
	}
	if _, err := pool.Exec(ctx, SchemaSQL); err != nil {
		return err
	}
	_, err = pool.Exec(ctx, GrantSQL)
	return err
}

func CheckDatabaseSchema(ctx context.Context, databaseURL string) error {
	pool, err := pgxpool.New(ctx, strings.TrimSpace(databaseURL))
	if err != nil {
		return err
	}
	defer pool.Close()
	for _, table := range []string{"execution_config.connection_revisions", "execution_config.profiles", "execution_config.profile_validations", "execution_config.activation_bundles", "execution_config.active_bundle", "execution_config.command_receipts", "execution_config.audit_events"} {
		var exists bool
		if err := pool.QueryRow(ctx, "select to_regclass($1) is not null", table).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("%s table is not installed", table)
		}
	}
	checks := []struct {
		privilege string
		role      string
		table     string
	}{
		{privilege: "SELECT", role: "execution_provider_config_reader", table: "execution_config.connection_revisions"},
		{privilege: "SELECT", role: "execution_provider_config_reader", table: "execution_config.active_bundle"},
		{privilege: "SELECT", role: "execution_provider_config_admin", table: "execution_config.command_receipts"},
		{privilege: "INSERT", role: "execution_provider_config_admin", table: "execution_config.audit_events"},
	}
	for _, check := range checks {
		var granted bool
		if err := pool.QueryRow(ctx, "select has_table_privilege($1,$2,$3)", check.role, check.table, check.privilege).Scan(&granted); err != nil {
			return err
		}
		if !granted {
			return fmt.Errorf("database role %s lacks %s on %s", check.role, check.privilege, check.table)
		}
	}
	return nil
}

func (s *Store) EnsureSchema(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, SchemaSQL)
	if err != nil {
		return fmt.Errorf("ensure provider config schema: %w", err)
	}
	return nil
}

func (s *Store) HealthCheck(ctx context.Context) error {
	if s == nil || s.pool == nil || s.keyring == nil {
		return ErrNotConfigured
	}
	for _, table := range []string{"execution_config.connection_revisions", "execution_config.profiles", "execution_config.active_bundle"} {
		var exists bool
		if err := s.pool.QueryRow(ctx, "select to_regclass($1) is not null", table).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("%s table is not installed", table)
		}
	}
	_, err := s.ResolveBundle(ctx)
	return err
}

func (s *Store) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}

func (s *Store) CreateConnection(
	ctx context.Context,
	actor string,
	idempotencyKey string,
	requestHash string,
	input ConnectionInput,
) (ConnectionView, int, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return ConnectionView{}, 400, errors.New("Idempotency-Key is required")
	}
	id := strings.TrimSpace(input.ConnectionID)
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ConnectionView{}, 500, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1,0))`, "execution_config.command_receipt:"+idempotencyKey); err != nil {
		return ConnectionView{}, 500, err
	}
	existingRaw, existingStatus, found, err := readCommandReceiptTx(ctx, tx, idempotencyKey, "create_connection", requestHash)
	if err != nil {
		return ConnectionView{}, existingStatus, err
	}
	if found {
		var existing ConnectionView
		if err := json.Unmarshal(existingRaw, &existing); err != nil {
			return ConnectionView{}, 500, err
		}
		return existing, existingStatus, nil
	}
	if id == "" {
		id = newID("connection")
	}
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1,0))`, "execution_config.connection:"+id); err != nil {
		return ConnectionView{}, 500, err
	}
	var revision int64
	if err := tx.QueryRow(ctx, "select coalesce(max(revision),0)+1 from execution_config.connection_revisions where connection_id=$1", id).Scan(&revision); err != nil {
		return ConnectionView{}, 500, err
	}
	secret, err := s.keyring.Encrypt(input.APIKey, connectionAAD(id, revision))
	if err != nil {
		return ConnectionView{}, 500, err
	}
	features, _ := json.Marshal(input.Features)
	featureConfig, _ := json.Marshal(input.FeatureConfig)
	createdAt := time.Now().UTC()
	_, err = tx.Exec(ctx, `insert into execution_config.connection_revisions
		(connection_id,revision,provider,base_url,features_json,feature_config_json,secret_key_id,secret_nonce,secret_ciphertext,secret_fingerprint,secret_last4,created_at,created_by)
		values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, id, revision, input.Provider, input.BaseURL, features, featureConfig, secret.KeyID, secret.Nonce, secret.Ciphertext, secret.Fingerprint, secret.Last4, createdAt, actor)
	if err != nil {
		return ConnectionView{}, 422, err
	}
	view := ConnectionView{BaseURL: input.BaseURL, ConnectionID: id, FeatureConfig: input.FeatureConfig, Features: input.Features, Provider: input.Provider, Revision: revision, SecretFingerprint: secret.Fingerprint, SecretLast4: secret.Last4}
	if err := writeCommandReceiptTx(ctx, tx, idempotencyKey, "create_connection", requestHash, 201, view, createdAt); err != nil {
		return ConnectionView{}, 500, err
	}
	if err := writeAuditTx(ctx, tx, actor, "provider_connection.created", fmt.Sprintf("%s:%d", id, revision), map[string]any{"provider": input.Provider}); err != nil {
		return ConnectionView{}, 500, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ConnectionView{}, 500, err
	}
	return view, 201, nil
}

func (s *Store) CreateProfile(
	ctx context.Context,
	actor string,
	idempotencyKey string,
	requestHash string,
	input ProfileInput,
) (ProfileView, int, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return ProfileView{}, 400, errors.New("Idempotency-Key is required")
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ProfileView{}, 500, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1,0))`, "execution_config.command_receipt:"+idempotencyKey); err != nil {
		return ProfileView{}, 500, err
	}
	existingRaw, existingStatus, found, err := readCommandReceiptTx(ctx, tx, idempotencyKey, "create_profile", requestHash)
	if err != nil {
		return ProfileView{}, existingStatus, err
	}
	if found {
		var existing ProfileView
		if err := json.Unmarshal(existingRaw, &existing); err != nil {
			return ProfileView{}, 500, err
		}
		return existing, existingStatus, nil
	}
	if input.ProfileID == "" {
		input.ProfileID = newID("profile")
	}
	var featuresRaw []byte
	if input.ConnectionRevision == 0 {
		if err := tx.QueryRow(ctx, `select revision,features_json from execution_config.connection_revisions where connection_id=$1 order by revision desc limit 1`, input.ConnectionID).Scan(&input.ConnectionRevision, &featuresRaw); err != nil {
			return ProfileView{}, 422, err
		}
	} else if err := tx.QueryRow(ctx, `select features_json from execution_config.connection_revisions where connection_id=$1 and revision=$2`, input.ConnectionID, input.ConnectionRevision).Scan(&featuresRaw); err != nil {
		return ProfileView{}, 422, err
	}
	var features []string
	if err := json.Unmarshal(featuresRaw, &features); err != nil {
		return ProfileView{}, 500, fmt.Errorf("decode provider connection features: %w", err)
	}
	if !containsString(features, input.Kind) {
		return ProfileView{}, 422, fmt.Errorf("connection revision does not declare %s capability", input.Kind)
	}
	now := time.Now().UTC()
	_, err = tx.Exec(ctx, `insert into execution_config.profiles
		(profile_id,role,kind,connection_id,connection_revision,model,transport,dimensions,timeout_ms,created_at,created_by)
		values($1,$2,$3,$4,$5,$6,$7,nullif($8,0),$9,$10,$11)`, input.ProfileID, input.Role, input.Kind, input.ConnectionID, input.ConnectionRevision, input.Model, input.Transport, input.Dimensions, input.TimeoutMS, now, actor)
	if err != nil {
		return ProfileView{}, 422, err
	}
	view := profileView(input, "unvalidated")
	if err := writeCommandReceiptTx(ctx, tx, idempotencyKey, "create_profile", requestHash, 201, view, now); err != nil {
		return ProfileView{}, 500, err
	}
	if err := writeAuditTx(ctx, tx, actor, "provider_profile.created", input.ProfileID, map[string]any{"role": input.Role}); err != nil {
		return ProfileView{}, 500, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ProfileView{}, 500, err
	}
	return view, 201, nil
}

func (s *Store) Resolve(ctx context.Context, role Role) (RuntimeSnapshot, error) {
	bundle, err := s.ResolveBundle(ctx)
	if err != nil {
		return RuntimeSnapshot{}, err
	}
	snapshot, ok := bundle[role]
	if !ok {
		return RuntimeSnapshot{}, fmt.Errorf("%w: active role %s", ErrNotFound, role)
	}
	return snapshot, nil
}

func (s *Store) ResolveBundle(ctx context.Context) (map[Role]RuntimeSnapshot, error) {
	var revision int64
	var raw []byte
	err := s.pool.QueryRow(ctx, `select a.revision,b.profiles_json from execution_config.active_bundle a join execution_config.activation_bundles b on b.bundle_id=a.bundle_id where a.singleton=true`).Scan(&revision, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: no active provider bundle", ErrNotFound)
	}
	if err != nil {
		return nil, err
	}
	var profileIDs map[Role]string
	if err := json.Unmarshal(raw, &profileIDs); err != nil {
		return nil, err
	}
	result := make(map[Role]RuntimeSnapshot, len(profileIDs))
	for role, profileID := range profileIDs {
		snapshot, err := s.resolveProfile(ctx, profileID, revision)
		if err != nil {
			return nil, err
		}
		if Role(snapshot.Role) != role {
			return nil, fmt.Errorf("active provider bundle role mismatch for %s", role)
		}
		result[role] = snapshot
	}
	if _, ok := result[RolePrimaryAgent]; !ok {
		return nil, fmt.Errorf("%w: active bundle missing primary_agent", ErrNotFound)
	}
	if _, ok := result[RoleRAGQueryEmbedding]; !ok {
		return nil, fmt.Errorf("%w: active bundle missing rag_query_embedding", ErrNotFound)
	}
	return result, nil
}

func (s *Store) resolveProfile(ctx context.Context, profileID string, bundleRevision int64) (RuntimeSnapshot, error) {
	var snapshot RuntimeSnapshot
	var keyID string
	var nonce, ciphertext, featureConfig []byte
	var connectionID string
	var connectionRevision int64
	err := s.pool.QueryRow(ctx, `select p.role,p.kind,p.model,p.transport,coalesce(p.dimensions,0),p.timeout_ms,p.connection_id,p.connection_revision,c.provider,c.base_url,c.feature_config_json,c.secret_key_id,c.secret_nonce,c.secret_ciphertext
		from execution_config.profiles p join execution_config.connection_revisions c on c.connection_id=p.connection_id and c.revision=p.connection_revision where p.profile_id=$1`, profileID).Scan(&snapshot.Role, &snapshot.Kind, &snapshot.Model, &snapshot.Transport, &snapshot.Dimensions, &snapshot.TimeoutMS, &connectionID, &connectionRevision, &snapshot.Provider, &snapshot.BaseURL, &featureConfig, &keyID, &nonce, &ciphertext)
	if errors.Is(err, pgx.ErrNoRows) {
		return RuntimeSnapshot{}, fmt.Errorf("%w: profile %s", ErrNotFound, profileID)
	}
	if err != nil {
		return RuntimeSnapshot{}, err
	}
	snapshot.APIKey, err = s.keyring.Decrypt(keyID, nonce, ciphertext, connectionAAD(connectionID, connectionRevision))
	if err != nil {
		return RuntimeSnapshot{}, err
	}
	_ = json.Unmarshal(featureConfig, &snapshot.ToolConfig)
	snapshot.ProfileID = profileID
	snapshot.Revision = bundleRevision
	return snapshot, nil
}

func (s *Store) RecordValidation(ctx context.Context, actor, profileID string, result ValidationResult) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `insert into execution_config.profile_validations(validation_id,profile_id,status,error_code,message,observed_dimensions,validated_at,validated_by) values($1,$2,$3,$4,$5,nullif($6,0),$7,$8)`, newID("validation"), profileID, result.Status, result.ErrorCode, result.Message, result.ObservedDimensions, time.Now().UTC(), actor)
	if err != nil {
		return err
	}
	if err := writeAuditTx(ctx, tx, actor, "provider_profile.validated", profileID, map[string]any{"status": result.Status, "errorCode": result.ErrorCode}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) Activate(ctx context.Context, actor, idempotencyKey, requestHash string, input ActivationInput) (map[string]any, int, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return nil, 400, errors.New("Idempotency-Key is required")
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, 500, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended('execution_config.activation',0))`); err != nil {
		return nil, 500, err
	}
	existingRaw, existingStatus, found, err := readCommandReceiptTx(ctx, tx, idempotencyKey, "activate_bundle", requestHash)
	if err != nil {
		return nil, existingStatus, err
	}
	if found {
		var response map[string]any
		if err := json.Unmarshal(existingRaw, &response); err != nil {
			return nil, 500, err
		}
		return response, existingStatus, nil
	}
	var currentRevision int64
	err = tx.QueryRow(ctx, `select revision from execution_config.active_bundle where singleton=true for update`).Scan(&currentRevision)
	if errors.Is(err, pgx.ErrNoRows) {
		currentRevision = 0
	} else if err != nil {
		return nil, 500, err
	}
	if currentRevision != input.ExpectedRevision {
		return nil, 409, ErrConflict
	}
	if input.Profiles[RolePrimaryAgent] == "" || input.Profiles[RoleRAGQueryEmbedding] == "" {
		return nil, 422, errors.New("primary_agent and rag_query_embedding profiles are required")
	}
	for role, profileID := range input.Profiles {
		var storedRole Role
		var validationStatus string
		err = tx.QueryRow(ctx, `select p.role,coalesce((select status from execution_config.profile_validations v where v.profile_id=p.profile_id order by validated_at desc limit 1),'') from execution_config.profiles p where p.profile_id=$1`, profileID).Scan(&storedRole, &validationStatus)
		if err != nil || storedRole != role || validationStatus != "passed" {
			return nil, 422, fmt.Errorf("profile %s is not validated for role %s", profileID, role)
		}
	}
	nextRevision := currentRevision + 1
	bundleID := newID("bundle")
	profilesJSON, _ := json.Marshal(input.Profiles)
	now := time.Now().UTC()
	if _, err := tx.Exec(ctx, `insert into execution_config.activation_bundles(bundle_id,revision,profiles_json,activated_at,activated_by) values($1,$2,$3,$4,$5)`, bundleID, nextRevision, profilesJSON, now, actor); err != nil {
		return nil, 500, err
	}
	if _, err := tx.Exec(ctx, `insert into execution_config.active_bundle(singleton,bundle_id,revision,updated_at) values(true,$1,$2,$3) on conflict(singleton) do update set bundle_id=excluded.bundle_id,revision=excluded.revision,updated_at=excluded.updated_at`, bundleID, nextRevision, now); err != nil {
		return nil, 500, err
	}
	response := map[string]any{"activeRevision": nextRevision, "bundleId": bundleID, "profiles": input.Profiles}
	if err := writeCommandReceiptTx(ctx, tx, idempotencyKey, "activate_bundle", requestHash, 200, response, now); err != nil {
		return nil, 500, err
	}
	details, _ := json.Marshal(map[string]any{"revision": nextRevision, "profiles": input.Profiles})
	if _, err := tx.Exec(ctx, `insert into execution_config.audit_events(event_id,event_type,actor_id,target_id,details_json,occurred_at) values($1,'provider_bundle.activated',$2,$3,$4,$5)`, newID("audit"), actor, bundleID, details, now); err != nil {
		return nil, 500, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, 500, err
	}
	return response, 200, nil
}

func (s *Store) Status(ctx context.Context) (Status, error) {
	status := Status{SampledAt: time.Now().UTC()}
	err := s.pool.QueryRow(ctx, `select revision from execution_config.active_bundle where singleton=true`).Scan(&status.ActiveRevision)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Status{}, err
	}
	rows, err := s.pool.Query(ctx, `select connection_id,revision,provider,base_url,features_json,feature_config_json,secret_fingerprint,secret_last4 from execution_config.connection_revisions order by created_at desc`)
	if err != nil {
		return Status{}, err
	}
	for rows.Next() {
		var view ConnectionView
		var features, featureConfig []byte
		if err := rows.Scan(&view.ConnectionID, &view.Revision, &view.Provider, &view.BaseURL, &features, &featureConfig, &view.SecretFingerprint, &view.SecretLast4); err != nil {
			rows.Close()
			return Status{}, err
		}
		if err := json.Unmarshal(features, &view.Features); err != nil {
			rows.Close()
			return Status{}, err
		}
		if err := json.Unmarshal(featureConfig, &view.FeatureConfig); err != nil {
			rows.Close()
			return Status{}, err
		}
		status.Connections = append(status.Connections, view)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return Status{}, err
	}
	profileRows, err := s.pool.Query(ctx, `select p.profile_id,p.role,p.kind,p.connection_id,p.connection_revision,p.model,p.transport,coalesce(p.dimensions,0),p.timeout_ms,coalesce((select status from execution_config.profile_validations v where v.profile_id=p.profile_id order by validated_at desc limit 1),'unvalidated') from execution_config.profiles p order by p.created_at desc`)
	if err != nil {
		return Status{}, err
	}
	for profileRows.Next() {
		var view ProfileView
		if err := profileRows.Scan(&view.ProfileID, &view.Role, &view.Kind, &view.ConnectionID, &view.ConnectionRevision, &view.Model, &view.Transport, &view.Dimensions, &view.TimeoutMS, &view.ValidationStatus); err != nil {
			profileRows.Close()
			return Status{}, err
		}
		status.Profiles = append(status.Profiles, view)
	}
	profileRows.Close()
	if err := profileRows.Err(); err != nil {
		return Status{}, err
	}
	active := map[Role]RuntimeSnapshot{}
	if status.ActiveRevision > 0 {
		active, err = s.ResolveBundle(ctx)
		if err != nil {
			return Status{}, err
		}
	}
	for _, role := range []Role{RolePrimaryAgent, RoleRAGQueryEmbedding, RoleRAGReranker} {
		snapshot, ok := active[role]
		status.Roles = append(status.Roles, RoleStatus{Configured: ok, Model: snapshot.Model, ProfileID: snapshot.ProfileID, Provider: snapshot.Provider, Role: role, Transport: snapshot.Transport})
	}
	return status, nil
}

func writeAuditTx(ctx context.Context, tx pgx.Tx, actor, eventType, target string, details map[string]any) error {
	raw, _ := json.Marshal(details)
	_, err := tx.Exec(ctx, `insert into execution_config.audit_events(event_id,event_type,actor_id,target_id,details_json,occurred_at) values($1,$2,$3,$4,$5,$6)`, newID("audit"), eventType, actor, target, raw, time.Now().UTC())
	return err
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func connectionAAD(id string, revision int64) string {
	return fmt.Sprintf("execution_config.connection:%s:%d", id, revision)
}

func profileView(input ProfileInput, validation string) ProfileView {
	return ProfileView{ConnectionID: input.ConnectionID, ConnectionRevision: input.ConnectionRevision, Dimensions: input.Dimensions, Kind: input.Kind, Model: input.Model, ProfileID: input.ProfileID, Role: input.Role, TimeoutMS: input.TimeoutMS, Transport: input.Transport, ValidationStatus: validation}
}
