package campusdocs

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var collectionPattern = regexp.MustCompile(`^campus_docs_[a-f0-9]{64}$`)

const defaultIndexStoreMaxConns int32 = 2

// Index is the immutable query binding selected for online retrieval.
type Index struct {
	Collection                string
	DenseVectorName           string
	EmbeddingDimensions       int
	EmbeddingQueryInstruction string
	EmbeddingSpaceID          string
	SparseModel               string
	SparseVectorName          string
}

type IndexStore interface {
	CurrentIndex(ctx context.Context) (Index, bool, error)
}

type PostgresIndexStore struct {
	pool *pgxpool.Pool
}

func NewPostgresIndexStore(databaseURL string) IndexStore {
	databaseURL = strings.TrimSpace(databaseURL)
	if databaseURL == "" {
		return nil
	}
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil
	}
	config.MinConns = 0
	config.MaxConns = defaultIndexStoreMaxConns
	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil
	}
	return &PostgresIndexStore{pool: pool}
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
		`select collection,
		        dense_vector_name,
		        embedding_dimensions,
		        embedding_query_instruction,
		        embedding_space_id,
		        sparse_model,
		        sparse_vector_name
		   from campus_docs_serving.current_index
		  where singleton = true`,
	).Scan(
		&index.Collection,
		&index.DenseVectorName,
		&index.EmbeddingDimensions,
		&index.EmbeddingQueryInstruction,
		&index.EmbeddingSpaceID,
		&index.SparseModel,
		&index.SparseVectorName,
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
	if !collectionPattern.MatchString(strings.TrimSpace(index.Collection)) ||
		strings.TrimSpace(index.DenseVectorName) == "" ||
		index.EmbeddingDimensions <= 0 ||
		strings.TrimSpace(index.EmbeddingQueryInstruction) == "" ||
		strings.TrimSpace(index.EmbeddingSpaceID) == "" ||
		strings.TrimSpace(index.SparseModel) == "" ||
		strings.TrimSpace(index.SparseVectorName) == "" {
		return errors.New("campus docs current index query binding is invalid")
	}
	return nil
}
