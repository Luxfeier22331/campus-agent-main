package campussearch

import (
	"context"
	"errors"
	"regexp"
	"strings"
)

var collectionPattern = regexp.MustCompile(`^campus_docs_[a-f0-9]{64}$`)

// Index is the immutable query binding selected for online retrieval.
type Index struct {
	Collection string
}

type IndexStore interface {
	CurrentIndex(ctx context.Context) (Index, bool, error)
}

func ValidateIndex(index Index) error {
	if !collectionPattern.MatchString(strings.TrimSpace(index.Collection)) {
		return errors.New("campus docs current index query binding is invalid")
	}
	return nil
}
