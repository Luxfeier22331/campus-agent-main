package campusdocs

import "context"

type SearchQuery struct {
	RetrievalQuery string
	RerankQuery    string
}

type Searcher interface {
	Search(context.Context, Index, SearchQuery, int) ([]SearchResultItem, error)
}
