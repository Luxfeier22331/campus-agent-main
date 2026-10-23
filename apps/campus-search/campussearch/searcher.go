package campussearch

import (
	"context"
	searchapi "github.com/MUC-WIKI/campus-agent/packages/search-api-go"
)

type SearchQuery struct {
	RetrievalQuery     string
	RerankQuery        string
	ExcludedResultRefs []string
}

type RetrievalScope struct {
	Mode          string
	AdmissionYear *int
	VersionSlug   string
}

type Searcher interface {
	Search(context.Context, Index, SearchQuery, int) ([]searchapi.SearchResultItem, error)
}
