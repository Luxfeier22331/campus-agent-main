package structuredquery

import "context"

type fakeNoticeReadModelStore struct {
	searchRows             []noticeReadModelRecord
	idRows                 []noticeReadModelRecord
	getRow                 *noticeReadModelRecord
	searchCount            int
	idLookupCount          int
	getCount               int
	searchQueryText        string
	searchMaxResults       int
	searchTargetSurfaces   []string
	searchTemporalQuery    temporalQuery
	searchDateRange        noticeDateRange
	searchAuthorization    noticeReadModelAuthorizationFilter
	idLookupNoticeIDs      []string
	idLookupTargetSurfaces []string
	idLookupAuthorization  noticeReadModelAuthorizationFilter
	getTargetSurfaces      []string
	getAuthorization       noticeReadModelAuthorizationFilter
}

func (s *fakeNoticeReadModelStore) SearchNotices(
	ctx context.Context,
	criteria noticeSearchCriteria,
) ([]noticeReadModelRecord, error) {
	s.searchCount++
	s.searchQueryText = criteria.QueryText
	s.searchTargetSurfaces = append([]string(nil), criteria.TargetSurfaces...)
	s.searchTemporalQuery = criteria.TemporalQuery
	s.searchDateRange = criteria.DateRange
	s.searchMaxResults = criteria.MaxResults
	s.searchAuthorization = criteria.Authorization
	return append([]noticeReadModelRecord(nil), s.searchRows...), nil
}

func (s *fakeNoticeReadModelStore) GetNoticesByIDs(
	ctx context.Context,
	criteria noticeIDsCriteria,
) ([]noticeReadModelRecord, error) {
	s.idLookupCount++
	s.idLookupNoticeIDs = append([]string(nil), criteria.NoticeIDs...)
	s.idLookupTargetSurfaces = append([]string(nil), criteria.TargetSurfaces...)
	s.idLookupAuthorization = criteria.Authorization
	if s.idRows != nil {
		return append([]noticeReadModelRecord(nil), s.idRows...), nil
	}
	return append([]noticeReadModelRecord(nil), s.searchRows...), nil
}

func (s *fakeNoticeReadModelStore) GetNoticeByID(
	ctx context.Context,
	criteria noticeGetCriteria,
) (noticeReadModelRecord, bool, error) {
	s.getCount++
	s.getTargetSurfaces = append([]string(nil), criteria.TargetSurfaces...)
	s.getAuthorization = criteria.Authorization
	if s.getRow == nil {
		return noticeReadModelRecord{}, false, nil
	}
	return *s.getRow, true, nil
}

type fakeNoticeBodyStore struct {
	bodies    map[string]string
	readCount int
}

func (s *fakeNoticeBodyStore) GetNoticeBody(ctx context.Context, objectKey string) (string, error) {
	s.readCount++
	body, ok := s.bodies[objectKey]
	if !ok {
		return "", errNoticeBodyUnavailable
	}
	return body, nil
}

func equalStrings(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
