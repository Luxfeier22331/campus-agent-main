package toolreadmodel

import (
	"context"
	"errors"
	"strings"
)

type Options struct {
	KnowledgeReadModelStore KnowledgeReadModelStore
	DatabaseURL             string
}

type Runtime struct {
	knowledgeReadModelStore KnowledgeReadModelStore
}

func NewRuntime(options Options) *Runtime {
	structuredProjectionDatabaseURL := strings.TrimSpace(options.DatabaseURL)
	knowledgeReadModelStore := options.KnowledgeReadModelStore
	if knowledgeReadModelStore == nil {
		knowledgeReadModelStore = NewPostgresKnowledgeReadModelStore(structuredProjectionDatabaseURL)
	}
	runtime := &Runtime{
		knowledgeReadModelStore: knowledgeReadModelStore,
	}
	return runtime
}

func (r *Runtime) Close() {
	if closer, ok := r.knowledgeReadModelStore.(interface{ Close() }); ok {
		closer.Close()
	}
}

func (r *Runtime) CurrentKnowledgeRelease(
	ctx context.Context,
	documentScope string,
) (KnowledgeServingRelease, bool, error) {
	if r == nil || r.knowledgeReadModelStore == nil {
		return KnowledgeServingRelease{}, false, errors.New("knowledge read model store is not configured")
	}
	return r.knowledgeReadModelStore.CurrentRelease(ctx, documentScope)
}
