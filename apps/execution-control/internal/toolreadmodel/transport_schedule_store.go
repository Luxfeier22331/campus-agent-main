package toolreadmodel

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultTransportScheduleReadModelMaxConns int32 = 2

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
	pool *pgxpool.Pool
}

func NewPostgresTransportScheduleReadModelStore(
	options TransportSchedulePostgresOptions,
) TransportScheduleReadModelStore {
	databaseURL := strings.TrimSpace(options.DatabaseURL)
	if databaseURL == "" {
		return nil
	}
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil
	}
	config.MinConns = 0
	config.MaxConns = defaultTransportScheduleReadModelMaxConns
	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil
	}
	return &PostgresTransportScheduleReadModelStore{pool: pool}
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
	var releaseID string
	err := s.pool.QueryRow(
		ctx,
		`select release_id from campus_services.transport_current where pointer_key = 'current'`,
	).Scan(&releaseID)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(releaseID) == "" {
		return "", errors.New("current transport schedule release is empty")
	}
	return releaseID, nil
}

func (s *PostgresTransportScheduleReadModelStore) ProjectionReady(ctx context.Context) (bool, error) {
	releaseID, err := s.CurrentReleaseID(ctx)
	if err != nil {
		return false, err
	}
	var routeCount int
	var departureCount int
	err = s.pool.QueryRow(
		ctx,
		`select
			(select count(*) from campus_services.transport_routes where release_id = $1),
			(select count(*) from campus_services.transport_departures where release_id = $1)`,
		releaseID,
	).Scan(&routeCount, &departureCount)
	return routeCount > 0 && departureCount > 0, err
}

func (s *PostgresTransportScheduleReadModelStore) LoadBundleForRelease(
	ctx context.Context,
	releaseID string,
) (projectionBundle, error) {
	if s == nil || s.pool == nil {
		return projectionBundle{}, errors.New("transport schedule read model store is not configured")
	}
	snapshot, sourceURLs, err := s.loadRelease(ctx, releaseID)
	if err != nil {
		return projectionBundle{}, err
	}
	routes, err := s.loadRoutes(ctx, releaseID)
	if err != nil {
		return projectionBundle{}, err
	}
	departures, err := s.loadDepartures(ctx, releaseID)
	if err != nil {
		return projectionBundle{}, err
	}
	releaseNotices := make([]transportReleaseNoticeRecord, 0, len(sourceURLs))
	for _, sourceURL := range sourceURLs {
		releaseNotices = append(releaseNotices, transportReleaseNoticeRecord{
			SourceNoticeID: sourceURL,
			SourceRef:      sourceURL,
			SourceURL:      sourceURL,
			AdmittedAt:     snapshot.PublishedAt,
			MaterializedAt: snapshot.PublishedAt,
		})
	}
	return projectionBundle{
		SchemaVersion:              "campus_services_transport.v1",
		TransportScheduleSnapshots: []transportScheduleSnapshotRecord{snapshot},
		TransportRoutes:            routes,
		ScheduledDepartures:        departures,
		TransportReleaseNotices:    releaseNotices,
	}, nil
}

func (s *PostgresTransportScheduleReadModelStore) loadRelease(
	ctx context.Context,
	releaseID string,
) (transportScheduleSnapshotRecord, []string, error) {
	var publishedAt time.Time
	var effectiveFrom time.Time
	var effectiveUntil *time.Time
	var sourceURLsJSON []byte
	err := s.pool.QueryRow(
		ctx,
		`select published_at, effective_from, effective_until, source_urls_json
		   from campus_services.transport_releases where release_id = $1`,
		releaseID,
	).Scan(&publishedAt, &effectiveFrom, &effectiveUntil, &sourceURLsJSON)
	if err != nil {
		return transportScheduleSnapshotRecord{}, nil, err
	}
	sourceURLs := []string{}
	if err := json.Unmarshal(sourceURLsJSON, &sourceURLs); err != nil {
		return transportScheduleSnapshotRecord{}, nil, err
	}
	sourceURLs = normalizeTransportSourceURLs(sourceURLs)
	if len(sourceURLs) == 0 {
		return transportScheduleSnapshotRecord{}, nil, errors.New("transport release source URLs are empty")
	}
	snapshot := transportScheduleSnapshotRecord{
		SnapshotID:    releaseID,
		PublishedAt:   publishedAt.UTC().Format(time.RFC3339),
		EffectiveFrom: beginningOfTransportDay(effectiveFrom.In(transportLocation)).Format(time.RFC3339),
		SourceRef:     sourceURLs[0],
		IsCurrent:     true,
		ScheduleScope: "baseline_revision",
		Precedence:    100,
	}
	if effectiveUntil != nil {
		snapshot.EffectiveUntil = beginningOfTransportDay(effectiveUntil.In(transportLocation)).Format(time.RFC3339)
	}
	return snapshot, sourceURLs, nil
}

func (s *PostgresTransportScheduleReadModelStore) loadRoutes(
	ctx context.Context,
	releaseID string,
) ([]transportRouteRecord, error) {
	rows, err := s.pool.Query(
		ctx,
		`select route_id, display_name, aliases_json, origin_campus, destination_campus,
		        origin_stop_id, origin_stop_name, destination_stop_id, destination_stop_name
		   from campus_services.transport_routes
		  where release_id = $1 order by sort_order, route_id`,
		releaseID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	routes := []transportRouteRecord{}
	for rows.Next() {
		var route transportRouteRecord
		var aliasesJSON []byte
		var originStop transportStopRecord
		var destinationStop transportStopRecord
		if err := rows.Scan(
			&route.RouteID,
			&route.DisplayName,
			&aliasesJSON,
			&route.OriginCampus,
			&route.DestinationCampus,
			&originStop.StopID,
			&originStop.DisplayName,
			&destinationStop.StopID,
			&destinationStop.DisplayName,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(aliasesJSON, &route.Aliases); err != nil {
			return nil, err
		}
		route.ServiceFamily = "campus_shuttle"
		route.Stops = []transportStopRecord{originStop, destinationStop}
		routes = append(routes, route)
	}
	return routes, rows.Err()
}

func (s *PostgresTransportScheduleReadModelStore) loadDepartures(
	ctx context.Context,
	releaseID string,
) ([]scheduledDepartureRecord, error) {
	rows, err := s.pool.Query(
		ctx,
		`select d.route_id, d.service_mode, d.service_date, d.departure_time,
		        d.departure_kind, d.status, d.note, d.source_urls_json,
		        r.origin_stop_id, r.destination_stop_id
		   from campus_services.transport_departures d
		   join campus_services.transport_routes r
		     on r.release_id = d.release_id and r.route_id = d.route_id
		  where d.release_id = $1 order by d.sort_order, d.departure_id`,
		releaseID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	departures := []scheduledDepartureRecord{}
	for rows.Next() {
		var record scheduledDepartureRecord
		var operationalComment *string
		var serviceDate *time.Time
		var sourceURLsJSON []byte
		if err := rows.Scan(
			&record.RouteID,
			&record.ServiceMode,
			&serviceDate,
			&record.DepartureTime,
			&record.DepartureKind,
			&record.DepartureStatus,
			&operationalComment,
			&sourceURLsJSON,
			&record.OriginStopID,
			&record.DestinationStopID,
		); err != nil {
			return nil, err
		}
		if serviceDate != nil {
			record.ServiceDates = []string{serviceDate.In(transportLocation).Format(transportLocalDateLayout)}
		}
		if operationalComment != nil {
			record.OperationalComment = *operationalComment
		}
		if err := json.Unmarshal(sourceURLsJSON, &record.RelatedNoticeRefs); err != nil {
			return nil, err
		}
		record.SnapshotID = releaseID
		departures = append(departures, record)
	}
	return departures, rows.Err()
}

func normalizeTransportSourceURLs(values []string) []string {
	result := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || (!strings.HasPrefix(value, "https://") && !strings.HasPrefix(value, "http://")) {
			continue
		}
		result = appendUniqueTransportRefs(result, []string{value})
	}
	return result
}
