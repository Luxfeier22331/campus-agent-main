package memorypersistence

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
)

// CopyDrainedState copies lifecycle metadata after admission and old workers have
// been stopped. Unknown provider operations must be resolved before cutover.
func CopyDrainedState(ctx context.Context, source, target string) error {
	src, err := pgx.Connect(ctx, source)
	if err != nil {
		return err
	}
	defer func() { _ = src.Close(ctx) }()
	dst, err := pgx.Connect(ctx, target)
	if err != nil {
		return err
	}
	defer func() { _ = dst.Close(ctx) }()
	st, err := src.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = st.Rollback(ctx) }()
	dt, err := dst.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = dt.Rollback(ctx) }()
	tables := []string{"personal_memory_owner_fences", "personal_memory_call_leases", "personal_memory_command_receipts"}
	for _, table := range tables {
		if _, err = st.Exec(ctx, "LOCK TABLE execution_control."+table+" IN ACCESS EXCLUSIVE MODE"); err != nil {
			return err
		}
		if _, err = dt.Exec(ctx, "LOCK TABLE memory."+table+" IN ACCESS EXCLUSIVE MODE"); err != nil {
			return err
		}
	}
	var busy bool
	if err = st.QueryRow(ctx, `select exists(select 1 from execution_control.personal_memory_call_leases where expires_at is null or expires_at>now()) or exists(select 1 from execution_control.personal_memory_command_receipts where status not in ('succeeded','failed')) or exists(select 1 from execution_control.agent_runs where status not in ('completed','failed','canceled','expired'))`).Scan(&busy); err != nil {
		return err
	}
	if busy {
		return fmt.Errorf("cutover requires drained runs, memory commands and provider call leases")
	}
	for _, table := range tables {
		var count int64
		if err = dt.QueryRow(ctx, "select count(*) from memory."+table).Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			return fmt.Errorf("target table %s must be empty", table)
		}
		rows, e := st.Query(ctx, "select * from execution_control."+table)
		if e != nil {
			return e
		}
		columns := []string{}
		for _, field := range rows.FieldDescriptions() {
			columns = append(columns, field.Name)
		}
		values := [][]any{}
		for rows.Next() {
			v, e := rows.Values()
			if e != nil {
				rows.Close()
				return e
			}
			values = append(values, v)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		if _, err = dt.CopyFrom(ctx, pgx.Identifier{"memory", table}, columns, pgx.CopyFromRows(values)); err != nil {
			return err
		}
	}
	if err = dt.Commit(ctx); err != nil {
		return err
	}
	return st.Commit(ctx)
}
