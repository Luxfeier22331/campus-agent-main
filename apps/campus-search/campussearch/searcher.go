package campussearch

import "context"

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
	Search(context.Context, Index, SearchQuery, int) ([]SearchResultItem, error)
}
