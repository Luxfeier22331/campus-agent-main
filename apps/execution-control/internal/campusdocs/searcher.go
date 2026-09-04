package campusdocs

import "context"

type Searcher interface {
	Search(context.Context, Index, string, int) ([]SearchResultItem, error)
}
