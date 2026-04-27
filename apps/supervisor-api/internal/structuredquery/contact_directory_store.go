package structuredquery

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultContactDirectoryReadModelMaxConns int32 = 2

type ContactDirectoryReadModelStore interface {
	HealthCheck(ctx context.Context) error
	CurrentReleaseID(ctx context.Context) (string, error)
	LoadBundleForRelease(ctx context.Context, releaseID string) (projectionBundle, error)
}

type ContactDirectoryPostgresOptions struct {
	DatabaseURL string
}

type PostgresContactDirectoryReadModelStore struct {
	pool            *pgxpool.Pool
	tableSQL        string
	schemaSQL       string
	conflictSQL     string
	manualReviewSQL string
	currentSQL      string
}

func NewPostgresContactDirectoryReadModelStore(
	options ContactDirectoryPostgresOptions,
) ContactDirectoryReadModelStore {
	databaseURL := strings.TrimSpace(options.DatabaseURL)
	if databaseURL == "" {
		return nil
	}
	config, err := contactDirectoryPostgresPoolConfig(options)
	if err != nil {
		return nil
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil
	}
	schemaSQL := qualifiedContactDirectorySchemaSQL()
	return &PostgresContactDirectoryReadModelStore{
		pool:            pool,
		tableSQL:        schemaSQL + `."contact_directory_read_model"`,
		schemaSQL:       schemaSQL,
		conflictSQL:     schemaSQL + `."contact_directory_conflicts"`,
		manualReviewSQL: schemaSQL + `."contact_directory_manual_review_sources"`,
		currentSQL:      schemaSQL + `."structured_projection_current"`,
	}
}

func contactDirectoryPostgresPoolConfig(
	options ContactDirectoryPostgresOptions,
) (*pgxpool.Config, error) {
	config, err := pgxpool.ParseConfig(strings.TrimSpace(options.DatabaseURL))
	if err != nil {
		return nil, err
	}
	config.MinConns = 0
	config.MaxConns = defaultContactDirectoryReadModelMaxConns
	return config, nil
}

func (s *PostgresContactDirectoryReadModelStore) HealthCheck(ctx context.Context) error {
	if s == nil || s.pool == nil {
		return errors.New("contact directory read model store is not configured")
	}
	return s.pool.Ping(ctx)
}

func (s *PostgresContactDirectoryReadModelStore) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}

func (s *PostgresContactDirectoryReadModelStore) CurrentReleaseID(
	ctx context.Context,
) (string, error) {
	if s == nil || s.pool == nil {
		return "", errors.New("contact directory read model store is not configured")
	}
	query := fmt.Sprintf(
		`select release_id from %s where corpus = $1 and collection = $2`,
		s.currentSQL,
	)
	var releaseID string
	if err := s.pool.QueryRow(ctx, query, "campus_services", "contact_directory").Scan(&releaseID); err != nil {
		return "", err
	}
	if strings.TrimSpace(releaseID) == "" {
		return "", errors.New("current contact directory release is empty")
	}
	return releaseID, nil
}

func (s *PostgresContactDirectoryReadModelStore) LoadBundleForRelease(
	ctx context.Context,
	releaseID string,
) (projectionBundle, error) {
	if s == nil || s.pool == nil {
		return projectionBundle{}, errors.New("contact directory read model store is not configured")
	}
	records, err := fetchStructuredJSONRecords[contactDirectoryRecord](
		ctx,
		s.pool,
		s.tableSQL,
		releaseID,
	)
	if err != nil {
		return projectionBundle{}, err
	}
	conflicts, err := fetchStructuredJSONRecords[contactDirectoryConflictRecord](
		ctx,
		s.pool,
		s.conflictSQL,
		releaseID,
	)
	if err != nil {
		return projectionBundle{}, err
	}
	manualReviews, err := fetchStructuredJSONRecords[contactDirectoryManualReviewInfo](
		ctx,
		s.pool,
		s.manualReviewSQL,
		releaseID,
	)
	if err != nil {
		return projectionBundle{}, err
	}
	return projectionBundle{
		SchemaVersion:                "campus_services_contact_directory_projection.v1",
		ContactDirectoryRecords:      records,
		ContactDirectoryConflicts:    conflicts,
		ContactDirectoryManualReview: manualReviews,
	}, nil
}

func qualifiedContactDirectorySchemaSQL() string {
	return `"ingestion_projection"`
}
