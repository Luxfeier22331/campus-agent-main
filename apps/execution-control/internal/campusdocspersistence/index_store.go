package campusdocspersistence

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultIndexStoreMaxConns int32 = 2

type PostgresIndexStore struct {
	pool *pgxpool.Pool
}

func NewPostgresIndexStore(databaseURL string) (campusdocs.IndexStore, error) {
	databaseURL = strings.TrimSpace(databaseURL)
	if databaseURL == "" {
		return nil, errors.New("campus docs index store database URL is not configured")
	}
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse campus docs index store database URL: %w", err)
	}
	config.MinConns = 0
	config.MaxConns = defaultIndexStoreMaxConns
	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil, fmt.Errorf("create campus docs index store: %w", err)
	}
	return &PostgresIndexStore{pool: pool}, nil
}

func (s *PostgresIndexStore) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}

func (s *PostgresIndexStore) CurrentIndex(
	ctx context.Context,
) (campusdocs.Index, bool, error) {
	if s == nil || s.pool == nil {
		return campusdocs.Index{}, false, errors.New("campus docs index store is not configured")
	}
	var index campusdocs.Index
	err := s.pool.QueryRow(
		ctx,
		`select collection
		   from campus_docs_serving.current_index
		  where singleton = true`,
	).Scan(
		&index.Collection,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return campusdocs.Index{}, false, nil
		}
		return campusdocs.Index{}, false, err
	}
	if err := campusdocs.ValidateIndex(index); err != nil {
		return campusdocs.Index{}, false, err
	}
	return index, true, nil
}
