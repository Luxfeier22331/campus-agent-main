package structuredquery

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultNoticeReadModelTable = "ingestion_projection.internal_notice_read_model"
const defaultNoticeReadModelMaxConns int32 = 2

var noticeSQLIdentifierRE = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type NoticePostgresOptions struct {
	DatabaseURL string
	TableName   string
}

type PostgresNoticeReadModelStore struct {
	pool     *pgxpool.Pool
	tableSQL string
}

func NewPostgresNoticeReadModelStore(options NoticePostgresOptions) NoticeReadModelStore {
	databaseURL := strings.TrimSpace(options.DatabaseURL)
	if databaseURL == "" {
		return nil
	}
	tableSQL, err := qualifiedNoticeTableSQL(options.TableName)
	if err != nil {
		return nil
	}
	config, err := noticePostgresPoolConfig(NoticePostgresOptions{
		DatabaseURL: databaseURL,
		TableName:   options.TableName,
	})
	if err != nil {
		return nil
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil
	}
	return &PostgresNoticeReadModelStore{
		pool:     pool,
		tableSQL: tableSQL,
	}
}

func noticePostgresPoolConfig(options NoticePostgresOptions) (*pgxpool.Config, error) {
	config, err := pgxpool.ParseConfig(strings.TrimSpace(options.DatabaseURL))
	if err != nil {
		return nil, err
	}
	config.MinConns = 0
	config.MaxConns = defaultNoticeReadModelMaxConns
	return config, nil
}

func (s *PostgresNoticeReadModelStore) SearchNotices(
	ctx context.Context,
	sourceFamilies []string,
	queryText string,
	maxResults int,
) ([]noticeReadModelRecord, error) {
	if s == nil || s.pool == nil {
		return nil, errors.New("notice read model store is not configured")
	}
	if maxResults <= 0 {
		maxResults = 5
	}
	normalizedQuery := strings.TrimSpace(queryText)
	params := []any{sourceFamilies}
	filters := []string{"queryable = true", "source_family = any($1)"}
	if normalizedQuery != "" {
		params = append(
			params,
			normalizedQuery,
			"%"+normalizedQuery+"%",
			"%"+normalizedQuery+"%",
		)
		filters = append(
			filters,
			fmt.Sprintf(
				"(search_vector @@ plainto_tsquery('simple', $%d) or title ilike $%d or search_text ilike $%d)",
				len(params)-2,
				len(params)-1,
				len(params),
			),
		)
	}
	params = append(params, maxResults)
	query := fmt.Sprintf(
		"select record from %s where %s order by published_at desc nulls last, source_notice_id desc, unit_id asc limit $%d",
		s.tableSQL,
		strings.Join(filters, " and "),
		len(params),
	)
	return s.fetchRecords(ctx, query, params...)
}

func (s *PostgresNoticeReadModelStore) GetNoticeByID(
	ctx context.Context,
	noticeID string,
	sourceFamily string,
) (noticeReadModelRecord, bool, error) {
	if s == nil || s.pool == nil {
		return noticeReadModelRecord{}, false, errors.New("notice read model store is not configured")
	}
	filters := []string{"queryable = true", "source_notice_id = $1"}
	params := []any{strings.TrimSpace(noticeID)}
	if strings.TrimSpace(sourceFamily) != "" {
		filters = append(filters, fmt.Sprintf("source_family = $%d", len(params)+1))
		params = append(params, strings.TrimSpace(sourceFamily))
	}
	query := fmt.Sprintf(
		"select record from %s where %s order by published_at desc nulls last, unit_id asc limit 1",
		s.tableSQL,
		strings.Join(filters, " and "),
	)
	rows, err := s.fetchRecords(ctx, query, params...)
	if err != nil {
		return noticeReadModelRecord{}, false, err
	}
	if len(rows) == 0 {
		return noticeReadModelRecord{}, false, nil
	}
	return rows[0], true, nil
}

func (s *PostgresNoticeReadModelStore) fetchRecords(
	ctx context.Context,
	query string,
	args ...any,
) ([]noticeReadModelRecord, error) {
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := []noticeReadModelRecord{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var record noticeReadModelRecord
		if err := json.Unmarshal(raw, &record); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	return records, nil
}

func (s *PostgresNoticeReadModelStore) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}

type NoticeS3Options struct {
	Endpoint      string
	AccessKey     string
	SecretKey     string
	Region        string
	BucketDerived string
}

type S3NoticeBodyStore struct {
	client *s3.Client
	bucket string
}

func NewS3NoticeBodyStore(options NoticeS3Options) NoticeBodyStore {
	endpoint := strings.TrimSpace(options.Endpoint)
	accessKey := strings.TrimSpace(options.AccessKey)
	secretKey := strings.TrimSpace(options.SecretKey)
	if endpoint == "" || accessKey == "" || secretKey == "" {
		return nil
	}
	region := strings.TrimSpace(options.Region)
	if region == "" {
		region = "us-east-1"
	}
	bucket := strings.TrimSpace(options.BucketDerived)
	if bucket == "" {
		bucket = "campus-rag-derived"
	}
	client := s3.New(s3.Options{
		BaseEndpoint: aws.String(endpoint),
		Credentials: aws.NewCredentialsCache(
			credentials.NewStaticCredentialsProvider(accessKey, secretKey, ""),
		),
		Region:       region,
		UsePathStyle: true,
	})
	return &S3NoticeBodyStore{
		client: client,
		bucket: bucket,
	}
}

func (s *S3NoticeBodyStore) GetNoticeBody(ctx context.Context, objectKey string) (string, error) {
	key := strings.TrimSpace(objectKey)
	if s == nil || s.client == nil || s.bucket == "" || key == "" {
		return "", errNoticeBodyUnavailable
	}
	response, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return "", errNoticeBodyUnavailable
	}
	defer func() {
		_ = response.Body.Close()
	}()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return "", errNoticeBodyUnavailable
	}
	return string(body), nil
}

func qualifiedNoticeTableSQL(tableName string) (string, error) {
	normalized := strings.TrimSpace(tableName)
	if normalized == "" {
		normalized = defaultNoticeReadModelTable
	}
	parts := strings.Split(normalized, ".")
	if len(parts) == 0 || len(parts) > 2 {
		return "", errors.New("notice read model table must be table or schema.table")
	}
	quoted := make([]string, 0, len(parts))
	for _, part := range parts {
		identifier := strings.TrimSpace(part)
		if !noticeSQLIdentifierRE.MatchString(identifier) {
			return "", fmt.Errorf("invalid notice read model table identifier: %s", identifier)
		}
		quoted = append(quoted, `"`+identifier+`"`)
	}
	return strings.Join(quoted, "."), nil
}
