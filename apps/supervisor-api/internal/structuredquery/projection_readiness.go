package structuredquery

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

func projectionTableReady(
	ctx context.Context,
	pool *pgxpool.Pool,
	tableSQL string,
	releaseID string,
) (bool, error) {
	query := fmt.Sprintf(
		`select exists(select 1 from %s where release_id = $1)`,
		tableSQL,
	)
	var ready bool
	if err := pool.QueryRow(ctx, query, releaseID).Scan(&ready); err != nil {
		return false, err
	}
	return ready, nil
}
