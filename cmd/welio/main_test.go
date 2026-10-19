package main

import "testing"

func TestMigrationDatabaseURL(t *testing.T) {
	tests := []struct {
		name    string
		env     map[string]string
		want    string
		wantErr bool
	}{
		{
			name: "direct URL takes precedence",
			env: map[string]string{
				"DATABASE_URL":        "postgres://pooled/db",
				"DATABASE_URL_DIRECT": "postgres://direct/db",
			},
			want: "postgres://direct/db",
		},
		{
			name: "pooled URL is used when no direct URL is set",
			env:  map[string]string{"DATABASE_URL": "postgres://pooled/db"},
			want: "postgres://pooled/db",
		},
		{
			name:    "database URL is required",
			env:     map[string]string{},
			wantErr: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := migrationDatabaseURL(func(key string) string { return test.env[key] })
			if test.wantErr {
				if err == nil {
					t.Fatal("migrationDatabaseURL() error = nil, want an error")
				}
				return
			}
			if err != nil {
				t.Fatalf("migrationDatabaseURL() error = %v", err)
			}
			if got != test.want {
				t.Fatalf("migrationDatabaseURL() = %q, want %q", got, test.want)
			}
		})
	}
}
