package structuredquery

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultCampusServicesOpsReleaseMaxConns int32 = 2

type CampusServicesOpsReleaseStore interface {
	HealthCheck(ctx context.Context) error
	LatestPublishedRelease(ctx context.Context) (campusServicesOpsRelease, error)
	ProjectionReady(ctx context.Context) (bool, error)
}

type CampusServicesOpsPostgresOptions struct {
	DatabaseURL string
}

type campusServicesOpsRelease struct {
	ReleaseID        string                                    `json:"release_id"`
	PublishedAt      string                                    `json:"published_at"`
	CurrentEffective campusServicesOpsCurrentEffectiveSnapshot `json:"current_effective"`
}

type campusServicesOpsCurrentEffectiveSnapshot struct {
	GeneratedAt             string                               `json:"generatedAt"`
	TransportOverrides      []campusServicesOpsTransportOverride `json:"transportOverrides"`
	GeneratedAtSnake        string                               `json:"generated_at"`
	TransportOverridesSnake []campusServicesOpsTransportOverride `json:"transport_overrides"`
}

type campusServicesOpsTransportOverride struct {
	OverrideID                string   `json:"overrideId"`
	RouteID                   string   `json:"routeId"`
	DisplayName               string   `json:"displayName"`
	ServiceStatus             string   `json:"serviceStatus"`
	Message                   string   `json:"message"`
	EffectiveFrom             string   `json:"effectiveFrom"`
	EffectiveUntil            string   `json:"effectiveUntil"`
	SourceAttestationIDs      []string `json:"sourceAttestationIds"`
	ReviewState               string   `json:"reviewState"`
	OverrideIDSnake           string   `json:"override_id"`
	RouteIDSnake              string   `json:"route_id"`
	DisplayNameSnake          string   `json:"display_name"`
	ServiceStatusSnake        string   `json:"service_status"`
	EffectiveFromSnake        string   `json:"effective_from"`
	EffectiveUntilSnake       string   `json:"effective_until"`
	SourceAttestationIDsSnake []string `json:"source_attestation_ids"`
	ReviewStateSnake          string   `json:"review_state"`
}

type campusServicesOpsReleaseCache struct {
	mu        sync.Mutex
	releaseID string
	release   campusServicesOpsRelease
}

type PostgresCampusServicesOpsReleaseStore struct {
	pool     *pgxpool.Pool
	tableSQL string
}

func NewPostgresCampusServicesOpsReleaseStore(
	options CampusServicesOpsPostgresOptions,
) CampusServicesOpsReleaseStore {
	databaseURL := strings.TrimSpace(options.DatabaseURL)
	if databaseURL == "" {
		return nil
	}
	config, err := campusServicesOpsPostgresPoolConfig(options)
	if err != nil {
		return nil
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil
	}
	return &PostgresCampusServicesOpsReleaseStore{
		pool:     pool,
		tableSQL: qualifiedCampusServicesOpsReleaseTableSQL(),
	}
}

func campusServicesOpsPostgresPoolConfig(
	options CampusServicesOpsPostgresOptions,
) (*pgxpool.Config, error) {
	config, err := pgxpool.ParseConfig(strings.TrimSpace(options.DatabaseURL))
	if err != nil {
		return nil, err
	}
	config.MinConns = 0
	config.MaxConns = defaultCampusServicesOpsReleaseMaxConns
	return config, nil
}

func (s *PostgresCampusServicesOpsReleaseStore) HealthCheck(ctx context.Context) error {
	if s == nil || s.pool == nil {
		return errors.New("campus services ops release store is not configured")
	}
	return s.pool.Ping(ctx)
}

func (s *PostgresCampusServicesOpsReleaseStore) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}

func (s *PostgresCampusServicesOpsReleaseStore) LatestPublishedRelease(
	ctx context.Context,
) (campusServicesOpsRelease, error) {
	if s == nil || s.pool == nil {
		return campusServicesOpsRelease{}, errors.New("campus services ops release store is not configured")
	}
	query := fmt.Sprintf(
		`select release_id, published_at, current_effective_json from %s where status = $1 order by published_at desc, release_id desc limit 1`,
		s.tableSQL,
	)
	var release campusServicesOpsRelease
	var rawCurrentEffective json.RawMessage
	var publishedAt time.Time
	if err := s.pool.QueryRow(ctx, query, "published").
		Scan(&release.ReleaseID, &publishedAt, &rawCurrentEffective); err != nil {
		return campusServicesOpsRelease{}, err
	}
	release.PublishedAt = publishedAt.Format(time.RFC3339)
	if strings.TrimSpace(release.ReleaseID) == "" {
		return campusServicesOpsRelease{}, errors.New("latest campus services ops release is empty")
	}
	if err := json.Unmarshal(rawCurrentEffective, &release.CurrentEffective); err != nil {
		return campusServicesOpsRelease{}, err
	}
	return normalizeCampusServicesOpsRelease(release), nil
}

func (s *PostgresCampusServicesOpsReleaseStore) ProjectionReady(
	ctx context.Context,
) (bool, error) {
	release, err := s.LatestPublishedRelease(ctx)
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(release.ReleaseID) != "", nil
}

func qualifiedCampusServicesOpsReleaseTableSQL() string {
	return `"campus_services_ops"."releases"`
}

func loadCampusServicesOpsReleaseFromStore(
	ctx context.Context,
	store CampusServicesOpsReleaseStore,
	cache *campusServicesOpsReleaseCache,
) (campusServicesOpsRelease, error) {
	if store == nil {
		return campusServicesOpsRelease{}, errors.New("campus services ops release store is not configured")
	}
	release, err := store.LatestPublishedRelease(ctx)
	if err != nil {
		return campusServicesOpsRelease{}, err
	}
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if cache.releaseID == release.ReleaseID {
		return cache.release, nil
	}
	cache.releaseID = release.ReleaseID
	cache.release = release
	return release, nil
}

func normalizeCampusServicesOpsRelease(release campusServicesOpsRelease) campusServicesOpsRelease {
	snapshot := release.CurrentEffective
	if strings.TrimSpace(snapshot.GeneratedAt) == "" {
		snapshot.GeneratedAt = snapshot.GeneratedAtSnake
	}
	if len(snapshot.TransportOverrides) == 0 && len(snapshot.TransportOverridesSnake) > 0 {
		snapshot.TransportOverrides = snapshot.TransportOverridesSnake
	}
	for index := range snapshot.TransportOverrides {
		normalizeCampusServicesOpsTransportOverride(&snapshot.TransportOverrides[index])
	}
	release.CurrentEffective = snapshot
	return release
}

func normalizeCampusServicesOpsTransportOverride(override *campusServicesOpsTransportOverride) {
	if strings.TrimSpace(override.OverrideID) == "" {
		override.OverrideID = override.OverrideIDSnake
	}
	if strings.TrimSpace(override.RouteID) == "" {
		override.RouteID = override.RouteIDSnake
	}
	if strings.TrimSpace(override.DisplayName) == "" {
		override.DisplayName = override.DisplayNameSnake
	}
	if strings.TrimSpace(override.ServiceStatus) == "" {
		override.ServiceStatus = override.ServiceStatusSnake
	}
	if strings.TrimSpace(override.EffectiveFrom) == "" {
		override.EffectiveFrom = override.EffectiveFromSnake
	}
	if strings.TrimSpace(override.EffectiveUntil) == "" {
		override.EffectiveUntil = override.EffectiveUntilSnake
	}
	if len(override.SourceAttestationIDs) == 0 && len(override.SourceAttestationIDsSnake) > 0 {
		override.SourceAttestationIDs = override.SourceAttestationIDsSnake
	}
	if strings.TrimSpace(override.ReviewState) == "" {
		override.ReviewState = override.ReviewStateSnake
	}
}
