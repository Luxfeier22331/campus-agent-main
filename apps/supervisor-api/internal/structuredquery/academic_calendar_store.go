package structuredquery

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultAcademicCalendarReadModelMaxConns int32 = 2

type AcademicCalendarReadModelStore interface {
	HealthCheck(ctx context.Context) error
	CurrentReleaseID(ctx context.Context) (string, error)
	ProjectionReady(ctx context.Context) (bool, error)
	LoadBundleForRelease(ctx context.Context, releaseID string) (projectionBundle, error)
}

type AcademicCalendarPostgresOptions struct {
	DatabaseURL string
}

type PostgresAcademicCalendarReadModelStore struct {
	pool      *pgxpool.Pool
	tableSQL  string
	currentSQL string
}

func NewPostgresAcademicCalendarReadModelStore(
	options AcademicCalendarPostgresOptions,
) AcademicCalendarReadModelStore {
	databaseURL := strings.TrimSpace(options.DatabaseURL)
	if databaseURL == "" {
		return nil
	}
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil
	}
	config.MinConns = 0
	config.MaxConns = defaultAcademicCalendarReadModelMaxConns
	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil
	}
	return &PostgresAcademicCalendarReadModelStore{
		pool:      pool,
		tableSQL:  `"ingestion_projection"."academic_calendar_read_model"`,
		currentSQL: `"ingestion_projection"."structured_projection_current"`,
	}
}

func (s *PostgresAcademicCalendarReadModelStore) HealthCheck(ctx context.Context) error {
	if s == nil || s.pool == nil {
		return errors.New("academic calendar read model store is not configured")
	}
	return s.pool.Ping(ctx)
}

func (s *PostgresAcademicCalendarReadModelStore) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}

func (s *PostgresAcademicCalendarReadModelStore) CurrentReleaseID(ctx context.Context) (string, error) {
	if s == nil || s.pool == nil {
		return "", errors.New("academic calendar read model store is not configured")
	}
	query := fmt.Sprintf(
		`select release_id from %s where corpus = $1 and collection = $2`,
		s.currentSQL,
	)
	var releaseID string
	if err := s.pool.QueryRow(ctx, query, "calendar", "academic_calendar").Scan(&releaseID); err != nil {
		return "", err
	}
	if strings.TrimSpace(releaseID) == "" {
		return "", errors.New("current academic calendar release is empty")
	}
	return releaseID, nil
}

func (s *PostgresAcademicCalendarReadModelStore) ProjectionReady(ctx context.Context) (bool, error) {
	if s == nil || s.pool == nil {
		return false, errors.New("academic calendar read model store is not configured")
	}
	releaseID, err := s.CurrentReleaseID(ctx)
	if err != nil {
		return false, err
	}
	return projectionTableReady(ctx, s.pool, s.tableSQL, releaseID)
}

func (s *PostgresAcademicCalendarReadModelStore) LoadBundleForRelease(
	ctx context.Context,
	releaseID string,
) (projectionBundle, error) {
	if s == nil || s.pool == nil {
		return projectionBundle{}, errors.New("academic calendar read model store is not configured")
	}
	records, err := fetchStructuredJSONRecords[academicCalendarRecord](ctx, s.pool, s.tableSQL, releaseID)
	if err != nil {
		return projectionBundle{}, err
	}
	return projectionBundle{
		SchemaVersion:           "academic_calendar_projection.v1",
		AcademicCalendarRecords: records,
	}, nil
}
