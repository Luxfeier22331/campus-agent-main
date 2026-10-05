package persistence

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/campus-search/campussearch"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultIndexStoreMaxConns int32 = 2

type PostgresIndexStore struct {
	pool *pgxpool.Pool
}

func NewPostgresIndexStore(databaseURL string) (*PostgresIndexStore, error) {
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
) (campussearch.Index, bool, error) {
	if s == nil || s.pool == nil {
		return campussearch.Index{}, false, errors.New("campus docs index store is not configured")
	}
	var index campussearch.Index
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
			return campussearch.Index{}, false, nil
		}
		return campussearch.Index{}, false, err
	}
	if err := campussearch.ValidateIndex(index); err != nil {
		return campussearch.Index{}, false, err
	}
	return index, true, nil
}
