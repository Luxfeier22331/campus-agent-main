package toolreadmodel

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultKnowledgeReadModelMaxConns int32 = 2

type KnowledgeServingRelease struct {
	Collection          string
	Corpus              string
	DocumentScope       string
	EmbeddingDimensions int
	EmbeddingModel      string
	QdrantCollection    string
	ReleaseID           string
}

type KnowledgeReadModelStore interface {
	CurrentRelease(ctx context.Context, documentScope string) (KnowledgeServingRelease, bool, error)
}

type PostgresKnowledgeReadModelStore struct {
	pool *pgxpool.Pool
}

func NewPostgresKnowledgeReadModelStore(databaseURL string) KnowledgeReadModelStore {
	databaseURL = strings.TrimSpace(databaseURL)
	if databaseURL == "" {
		return nil
	}
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil
	}
	config.MinConns = 0
	config.MaxConns = defaultKnowledgeReadModelMaxConns
	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil
	}
	return &PostgresKnowledgeReadModelStore{pool: pool}
}

func (s *PostgresKnowledgeReadModelStore) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}

func (s *PostgresKnowledgeReadModelStore) CurrentRelease(
	ctx context.Context,
	documentScope string,
) (KnowledgeServingRelease, bool, error) {
	if s == nil || s.pool == nil {
		return KnowledgeServingRelease{}, false, errors.New("knowledge read model store is not configured")
	}
	var release KnowledgeServingRelease
	err := s.pool.QueryRow(
		ctx,
		`select release.release_id, release.document_scope, release.corpus,
		        release.collection_name, release.qdrant_collection,
		        release.embedding_model, release.embedding_dimensions
		   from knowledge_serving.current_releases current
		   join knowledge_serving.releases release on release.release_id = current.release_id
		  where current.document_scope = $1 and release.document_scope = current.document_scope`,
		strings.TrimSpace(documentScope),
	).Scan(
		&release.ReleaseID,
		&release.DocumentScope,
		&release.Corpus,
		&release.Collection,
		&release.QdrantCollection,
		&release.EmbeddingModel,
		&release.EmbeddingDimensions,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return KnowledgeServingRelease{}, false, nil
		}
		return KnowledgeServingRelease{}, false, err
	}
	return release, true, nil
}
