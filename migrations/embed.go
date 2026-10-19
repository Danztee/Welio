// Package migrations embeds SQL migrations for the Welio database.
package migrations

import "embed"

// FS contains the initial schema and later migrations.
//
//go:embed *.up.sql *.down.sql
var FS embed.FS
