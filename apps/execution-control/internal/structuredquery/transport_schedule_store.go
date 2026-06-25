package structuredquery

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultTransportScheduleReadModelSchema         = "ingestion_projection"
	defaultTransportScheduleReadModelMaxConns int32 = 2
)

type TransportScheduleReadModelStore interface {
	HealthCheck(ctx context.Context) error
	CurrentReleaseID(ctx context.Context) (string, error)
	ProjectionReady(ctx context.Context) (bool, error)
	LoadBundleForRelease(ctx context.Context, releaseID string) (projectionBundle, error)
}

type TransportSchedulePostgresOptions struct {
	DatabaseURL string
}

type PostgresTransportScheduleReadModelStore struct {
	pool      *pgxpool.Pool
	schemaSQL string
}

func NewPostgresTransportScheduleReadModelStore(
	options TransportSchedulePostgresOptions,
) TransportScheduleReadModelStore {
	databaseURL := strings.TrimSpace(options.DatabaseURL)
	if databaseURL == "" {
		return nil
	}
	schemaSQL := qualifiedTransportScheduleSchemaSQL()
	config, err := transportSchedulePostgresPoolConfig(options)
	if err != nil {
		return nil
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil
	}
	return &PostgresTransportScheduleReadModelStore{
		pool:      pool,
		schemaSQL: schemaSQL,
	}
}

func transportSchedulePostgresPoolConfig(
	options TransportSchedulePostgresOptions,
) (*pgxpool.Config, error) {
	config, err := pgxpool.ParseConfig(strings.TrimSpace(options.DatabaseURL))
	if err != nil {
		return nil, err
	}
	config.MinConns = 0
	config.MaxConns = defaultTransportScheduleReadModelMaxConns
	return config, nil
}

func (s *PostgresTransportScheduleReadModelStore) HealthCheck(ctx context.Context) error {
	if s == nil || s.pool == nil {
		return errors.New("transport schedule read model store is not configured")
	}
	return s.pool.Ping(ctx)
}

func (s *PostgresTransportScheduleReadModelStore) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}

func (s *PostgresTransportScheduleReadModelStore) CurrentReleaseID(ctx context.Context) (string, error) {
	if s == nil || s.pool == nil {
		return "", errors.New("transport schedule read model store is not configured")
	}
	return s.currentReleaseID(ctx, "campus_services", "transport_schedule")
}

func (s *PostgresTransportScheduleReadModelStore) ProjectionReady(ctx context.Context) (bool, error) {
	if s == nil || s.pool == nil {
		return false, errors.New("transport schedule read model store is not configured")
	}
	releaseID, err := s.CurrentReleaseID(ctx)
	if err != nil {
		return false, err
	}
	return projectionTableReady(ctx, s.pool, s.tableSQL("transport_schedule_snapshots"), releaseID)
}

func (s *PostgresTransportScheduleReadModelStore) LoadBundleForRelease(
	ctx context.Context,
	releaseID string,
) (projectionBundle, error) {
	if s == nil || s.pool == nil {
		return projectionBundle{}, errors.New("transport schedule read model store is not configured")
	}
	snapshots, err := fetchStructuredJSONRecords[transportScheduleSnapshotRecord](
		ctx,
		s.pool,
		s.tableSQL("transport_schedule_snapshots"),
		releaseID,
	)
	if err != nil {
		return projectionBundle{}, err
	}
	routes, err := fetchStructuredJSONRecords[transportRouteRecord](
		ctx,
		s.pool,
		s.tableSQL("transport_routes"),
		releaseID,
	)
	if err != nil {
		return projectionBundle{}, err
	}
	departures, err := fetchStructuredJSONRecords[scheduledDepartureRecord](
		ctx,
		s.pool,
		s.tableSQL("transport_scheduled_departures"),
		releaseID,
	)
	if err != nil {
		return projectionBundle{}, err
	}
	exceptions, err := fetchStructuredJSONRecords[transportServiceExceptionRecord](
		ctx,
		s.pool,
		s.tableSQL("transport_service_exceptions"),
		releaseID,
	)
	if err != nil {
		return projectionBundle{}, err
	}
	operationalNotices, err := fetchStructuredJSONRecords[transportOperationalNoticeRecord](
		ctx,
		s.pool,
		s.tableSQL("transport_operational_notices"),
		releaseID,
	)
	if err != nil {
		return projectionBundle{}, err
	}
	return projectionBundle{
		SchemaVersion:               "campus_services_projection_bundle.v1",
		TransportScheduleSnapshots:  snapshots,
		TransportRoutes:             routes,
		ScheduledDepartures:         departures,
		TransportServiceExceptions:  exceptions,
		TransportOperationalNotices: operationalNotices,
	}, nil
}

func (s *PostgresTransportScheduleReadModelStore) currentReleaseID(
	ctx context.Context,
	corpus string,
	collection string,
) (string, error) {
	query := fmt.Sprintf(
		`select release_id from %s where corpus = $1 and collection = $2`,
		s.tableSQL("structured_projection_current"),
	)
	var releaseID string
	if err := s.pool.QueryRow(ctx, query, corpus, collection).Scan(&releaseID); err != nil {
		return "", err
	}
	if strings.TrimSpace(releaseID) == "" {
		return "", errors.New("current transport schedule release is empty")
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

func (s *PostgresTransportScheduleReadModelStore) tableSQL(tableName string) string {
	return s.schemaSQL + "." + quoteTransportScheduleIdentifier(tableName)
}

func qualifiedTransportScheduleSchemaSQL() string {
	return quoteTransportScheduleIdentifier(defaultTransportScheduleReadModelSchema)
}

func quoteTransportScheduleIdentifier(identifier string) string {
	return `"` + identifier + `"`
}
