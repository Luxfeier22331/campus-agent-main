package structuredquery

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultServiceGuideReadModelTable = "ingestion_projection.service_guide_read_model"
const defaultServiceGuideReadModelMaxConns int32 = 2

type ServiceGuideReadModelStore interface {
	HealthCheck(ctx context.Context) error
	CurrentReleaseID(ctx context.Context) (string, error)
	LoadBundleForRelease(ctx context.Context, releaseID string) (projectionBundle, error)
}

type ServiceGuidePostgresOptions struct {
	DatabaseURL string
}

type PostgresServiceGuideReadModelStore struct {
	pool            *pgxpool.Pool
	tableSQL        string
	schemaSQL       string
	conflictSQL     string
	manualReviewSQL string
	currentSQL      string
}

func NewPostgresServiceGuideReadModelStore(options ServiceGuidePostgresOptions) ServiceGuideReadModelStore {
	databaseURL := strings.TrimSpace(options.DatabaseURL)
	if databaseURL == "" {
		return nil
	}
	tableSQL := qualifiedServiceGuideTableSQL()
	schemaSQL := qualifiedServiceGuideSchemaSQL()
	config, err := serviceGuidePostgresPoolConfig(ServiceGuidePostgresOptions{
		DatabaseURL: databaseURL,
	})
	if err != nil {
		return nil
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil
	}
	return &PostgresServiceGuideReadModelStore{
		pool:            pool,
		tableSQL:        tableSQL,
		schemaSQL:       schemaSQL,
		conflictSQL:     schemaSQL + `."service_guide_conflicts"`,
		manualReviewSQL: schemaSQL + `."service_guide_manual_review_sources"`,
		currentSQL:      schemaSQL + `."structured_projection_current"`,
	}
}

func serviceGuidePostgresPoolConfig(options ServiceGuidePostgresOptions) (*pgxpool.Config, error) {
	config, err := pgxpool.ParseConfig(strings.TrimSpace(options.DatabaseURL))
	if err != nil {
		return nil, err
	}
	config.MinConns = 0
	config.MaxConns = defaultServiceGuideReadModelMaxConns
	return config, nil
}

func (s *PostgresServiceGuideReadModelStore) HealthCheck(ctx context.Context) error {
	if s == nil || s.pool == nil {
		return errors.New("service guide read model store is not configured")
	}
	return s.pool.Ping(ctx)
}

func (s *PostgresServiceGuideReadModelStore) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}

func (s *PostgresServiceGuideReadModelStore) CurrentReleaseID(ctx context.Context) (string, error) {
	if s == nil || s.pool == nil {
		return "", errors.New("service guide read model store is not configured")
	}
	return s.currentReleaseID(ctx, "campus_services", "service_guide")
}

func (s *PostgresServiceGuideReadModelStore) LoadBundleForRelease(
	ctx context.Context,
	releaseID string,
) (projectionBundle, error) {
	if s == nil || s.pool == nil {
		return projectionBundle{}, errors.New("service guide read model store is not configured")
	}
	records, err := fetchStructuredJSONRecords[serviceGuideRecord](
		ctx,
		s.pool,
		s.tableSQL,
		releaseID,
	)
	if err != nil {
		return projectionBundle{}, err
	}
	conflicts, err := fetchStructuredJSONRecords[serviceGuideConflictRecord](
		ctx,
		s.pool,
		s.conflictSQL,
		releaseID,
	)
	if err != nil {
		return projectionBundle{}, err
	}
	manualReviews, err := fetchStructuredJSONRecords[serviceGuideManualReviewRecord](
		ctx,
		s.pool,
		s.manualReviewSQL,
		releaseID,
	)
	if err != nil {
		return projectionBundle{}, err
	}
	return projectionBundle{
		SchemaVersion:             "campus_services_service_guide_projection.v1",
		ServiceGuideRecords:       records,
		ServiceGuideConflicts:     conflicts,
		ServiceGuideManualReviews: manualReviews,
	}, nil
}

func (s *PostgresServiceGuideReadModelStore) currentReleaseID(
	ctx context.Context,
	corpus string,
	collection string,
) (string, error) {
	query := fmt.Sprintf(
		`select release_id from %s where corpus = $1 and collection = $2`,
		s.currentSQL,
	)
	var releaseID string
	if err := s.pool.QueryRow(ctx, query, corpus, collection).Scan(&releaseID); err != nil {
		return "", err
	}
	if strings.TrimSpace(releaseID) == "" {
		return "", errors.New("current service guide release is empty")
	}
	return releaseID, nil
}

func fetchStructuredJSONRecords[T any](
	ctx context.Context,
	pool *pgxpool.Pool,
	tableSQL string,
	releaseID string,
) ([]T, error) {
	query := fmt.Sprintf(
		`select record from %s where release_id = $1 order by record_id`,
		tableSQL,
	)
	rows, err := pool.Query(ctx, query, releaseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	records := []T{}
	for rows.Next() {
		var raw json.RawMessage
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var record T
		if err := json.Unmarshal(raw, &record); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func qualifiedServiceGuideTableSQL() string {
	return `"ingestion_projection"."service_guide_read_model"`
}

func qualifiedServiceGuideSchemaSQL() string {
	return `"ingestion_projection"`
}
