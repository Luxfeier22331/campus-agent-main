package structuredquery

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultServiceStatusReadModelTable = "ingestion_projection.service_status_read_model"
const defaultServiceStatusReadModelMaxConns int32 = 2

type ServiceStatusReadModelStore interface {
	HealthCheck(ctx context.Context) error
	CurrentReleaseID(ctx context.Context) (string, error)
	LoadBundleForRelease(ctx context.Context, releaseID string) (projectionBundle, error)
}

type ServiceStatusPostgresOptions struct {
	DatabaseURL string
}

type PostgresServiceStatusReadModelStore struct {
	pool       *pgxpool.Pool
	tableSQL   string
	currentSQL string
}

func NewPostgresServiceStatusReadModelStore(
	options ServiceStatusPostgresOptions,
) ServiceStatusReadModelStore {
	databaseURL := strings.TrimSpace(options.DatabaseURL)
	if databaseURL == "" {
		return nil
	}
	tableSQL := qualifiedServiceStatusTableSQL()
	schemaSQL := qualifiedServiceStatusSchemaSQL()
	config, err := serviceStatusPostgresPoolConfig(ServiceStatusPostgresOptions{
		DatabaseURL: databaseURL,
	})
	if err != nil {
		return nil
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil
	}
	return &PostgresServiceStatusReadModelStore{
		pool:       pool,
		tableSQL:   tableSQL,
		currentSQL: schemaSQL + `."structured_projection_current"`,
	}
}

func serviceStatusPostgresPoolConfig(options ServiceStatusPostgresOptions) (*pgxpool.Config, error) {
	config, err := pgxpool.ParseConfig(strings.TrimSpace(options.DatabaseURL))
	if err != nil {
		return nil, err
	}
	config.MinConns = 0
	config.MaxConns = defaultServiceStatusReadModelMaxConns
	return config, nil
}

func (s *PostgresServiceStatusReadModelStore) HealthCheck(ctx context.Context) error {
	if s == nil || s.pool == nil {
		return errors.New("service status read model store is not configured")
	}
	return s.pool.Ping(ctx)
}

func (s *PostgresServiceStatusReadModelStore) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}

func (s *PostgresServiceStatusReadModelStore) CurrentReleaseID(
	ctx context.Context,
) (string, error) {
	if s == nil || s.pool == nil {
		return "", errors.New("service status read model store is not configured")
	}
	query := fmt.Sprintf(
		`select release_id from %s where corpus = $1 and collection = $2`,
		s.currentSQL,
	)
	var releaseID string
	if err := s.pool.QueryRow(ctx, query, "campus_services", "service_status").Scan(&releaseID); err != nil {
		return "", err
	}
	if strings.TrimSpace(releaseID) == "" {
		return "", errors.New("current service status release is empty")
	}
	return releaseID, nil
}

func (s *PostgresServiceStatusReadModelStore) LoadBundleForRelease(
	ctx context.Context,
	releaseID string,
) (projectionBundle, error) {
	if s == nil || s.pool == nil {
		return projectionBundle{}, errors.New("service status read model store is not configured")
	}
	records, err := fetchStructuredJSONRecords[serviceStatusRecord](
		ctx,
		s.pool,
		s.tableSQL,
		releaseID,
	)
	if err != nil {
		return projectionBundle{}, err
	}
	return projectionBundle{
		SchemaVersion:        "campus_services_projection_bundle.v1",
		ServiceStatusRecords: records,
	}, nil
}

func qualifiedServiceStatusTableSQL() string {
	return `"ingestion_projection"."service_status_read_model"`
}

func qualifiedServiceStatusSchemaSQL() string {
	return `"ingestion_projection"`
}
