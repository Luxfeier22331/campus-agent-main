package campusdocs

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var collectionPattern = regexp.MustCompile(`^campus_docs_[a-f0-9]{64}$`)

const defaultIndexStoreMaxConns int32 = 2

// Index is the immutable query binding selected for online retrieval.
type Index struct {
	Collection string
}

type IndexStore interface {
	CurrentIndex(ctx context.Context) (Index, bool, error)
}

type PostgresIndexStore struct {
	pool *pgxpool.Pool
}

func NewPostgresIndexStore(databaseURL string) (IndexStore, error) {
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

func (s *PostgresIndexStore) CurrentIndex(ctx context.Context) (Index, bool, error) {
	if s == nil || s.pool == nil {
		return Index{}, false, errors.New("campus docs index store is not configured")
	}
	var index Index
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
			return Index{}, false, nil
		}
		return Index{}, false, err
	}
	if err := ValidateIndex(index); err != nil {
		return Index{}, false, err
	}
	return index, true, nil
}

func ValidateIndex(index Index) error {
	if !collectionPattern.MatchString(strings.TrimSpace(index.Collection)) {
		return errors.New("campus docs current index query binding is invalid")
	}
	return nil
}
