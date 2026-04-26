package structuredquery

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultServiceGuideReadModelTable = "ingestion_projection.service_guide_read_model"
const defaultServiceGuideReadModelMaxConns int32 = 2

var serviceGuideSQLIdentifierRE = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type ServiceGuideReadModelStore interface {
	HealthCheck(ctx context.Context) error
}

type ServiceGuidePostgresOptions struct {
	DatabaseURL string
	TableName   string
}

type PostgresServiceGuideReadModelStore struct {
	pool     *pgxpool.Pool
	tableSQL string
}

func NewPostgresServiceGuideReadModelStore(options ServiceGuidePostgresOptions) ServiceGuideReadModelStore {
	databaseURL := strings.TrimSpace(options.DatabaseURL)
	if databaseURL == "" {
		return nil
	}
	tableSQL, err := qualifiedServiceGuideTableSQL(options.TableName)
	if err != nil {
		return nil
	}
	config, err := serviceGuidePostgresPoolConfig(ServiceGuidePostgresOptions{
		DatabaseURL: databaseURL,
		TableName:   options.TableName,
	})
	if err != nil {
		return nil
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil
	}
	return &PostgresServiceGuideReadModelStore{
		pool:     pool,
		tableSQL: tableSQL,
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

func qualifiedServiceGuideTableSQL(tableName string) (string, error) {
	normalized := strings.TrimSpace(tableName)
	if normalized == "" {
		normalized = defaultServiceGuideReadModelTable
	}
	parts := strings.Split(normalized, ".")
	if len(parts) == 0 || len(parts) > 2 {
		return "", errors.New("service guide read model table must be table or schema.table")
	}
	quoted := make([]string, 0, len(parts))
	for _, part := range parts {
		identifier := strings.TrimSpace(part)
		if !serviceGuideSQLIdentifierRE.MatchString(identifier) {
			return "", fmt.Errorf("invalid service guide read model table identifier: %s", identifier)
		}
		quoted = append(quoted, `"`+identifier+`"`)
	}
	return strings.Join(quoted, "."), nil
}
