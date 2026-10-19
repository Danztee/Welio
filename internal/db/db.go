// Package db opens PostgreSQL pools and applies database migrations.
package db

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"

	"github.com/danztee/welio/migrations"
)

type Querier interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type DB struct {
	Pool   *pgxpool.Pool
	Direct *pgxpool.Pool
}

func Open(ctx context.Context, pooledURL, directURL string) (*DB, error) {
	pooledCfg, err := pgxpool.ParseConfig(pooledURL)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	if directURL == "" {
		directURL = pooledURL
	}
	if directURL != pooledURL {
		pooledCfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeCacheDescribe
	}
	pooledCfg.AfterConnect = scanUTC
	pool, err := pgxpool.NewWithConfig(ctx, pooledCfg)
	if err != nil {
		return nil, fmt.Errorf("open database pool: %w", err)
	}
	direct := pool
	if directURL != pooledURL {
		directCfg, err := pgxpool.ParseConfig(directURL)
		if err != nil {
			pool.Close()
			return nil, fmt.Errorf("parse DATABASE_URL_DIRECT: %w", err)
		}
		directCfg.MaxConns = 10
		directCfg.AfterConnect = scanUTC
		direct, err = pgxpool.NewWithConfig(ctx, directCfg)
		if err != nil {
			pool.Close()
			return nil, fmt.Errorf("open direct database pool: %w", err)
		}
	}
	if err := pool.Ping(ctx); err != nil {
		if direct != pool {
			direct.Close()
		}
		pool.Close()
		return nil, fmt.Errorf("connect database: %w", err)
	}
	return &DB{Pool: pool, Direct: direct}, nil
}

func (d *DB) Close() {
	if d.Direct != d.Pool {
		d.Direct.Close()
	}
	d.Pool.Close()
}

func (d *DB) Ping(ctx context.Context) error { return d.Pool.Ping(ctx) }

func (d *DB) Tx(ctx context.Context, fn func(pgx.Tx) error) error {
	return pgx.BeginFunc(ctx, d.Pool, fn)
}

func Migrate(ctx context.Context, directURL string) error {
	pool, err := pgxpool.New(ctx, directURL)
	if err != nil {
		return fmt.Errorf("open migration pool: %w", err)
	}
	defer pool.Close()
	connection, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire migration lock connection: %w", err)
	}
	defer connection.Release()
	const migrationLock int64 = 0x57454c494f
	var locked bool
	if err := connection.QueryRow(ctx, `SELECT pg_advisory_lock($1) IS NULL`, migrationLock).Scan(&locked); err != nil {
		return fmt.Errorf("lock database migrations: %w", err)
	}
	defer func() {
		unlockCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = connection.Exec(unlockCtx, `SELECT pg_advisory_unlock($1)`, migrationLock)
	}()

	source, err := iofs.New(migrations.FS, ".")
	if err != nil {
		return fmt.Errorf("create migration source: %w", err)
	}
	databaseURL, err := migrationURL(directURL)
	if err != nil {
		return err
	}
	manager, err := migrate.NewWithSourceInstance("iofs", source, databaseURL)
	if err != nil {
		return fmt.Errorf("create migration runner: %w", err)
	}
	defer manager.Close()
	if err := manager.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("apply database migrations: %w", err)
	}

	migrator, err := rivermigrate.New(riverpgxv5.New(pool), nil)
	if err != nil {
		return fmt.Errorf("create River migration runner: %w", err)
	}
	if _, err := migrator.Migrate(ctx, rivermigrate.DirectionUp, nil); err != nil {
		return fmt.Errorf("apply River migrations: %w", err)
	}
	return nil
}

func migrationURL(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("parse migration database URL: %w", err)
	}
	if u.Scheme != "postgres" && u.Scheme != "postgresql" {
		return "", errors.New("DATABASE_URL_DIRECT must use postgres or postgresql")
	}
	query := u.Query()
	query.Set("x-multi-statement", "true")
	u.RawQuery = query.Encode()
	u.Scheme = "pgx5"
	return u.String(), nil
}

func scanUTC(_ context.Context, conn *pgx.Conn) error {
	conn.TypeMap().RegisterType(&pgtype.Type{Name: "timestamptz", OID: pgtype.TimestamptzOID,
		Codec: &pgtype.TimestamptzCodec{ScanLocation: time.UTC}})
	return nil
}

func IsNotFound(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

func IsUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return constraint == "" || pgErr.ConstraintName == constraint
	}
	return false
}
