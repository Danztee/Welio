package migrations

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestMigrationFiles(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	files := make(map[string]bool)
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			files[entry.Name()] = true
		}
	}
	if len(files) == 0 {
		t.Fatal("no SQL migrations found")
	}

	pattern := regexp.MustCompile(`^([0-9]{14})_[a-z0-9_]+\.(up|down)\.sql$`)
	versions := make(map[string]string)
	for name := range files {
		match := pattern.FindStringSubmatch(name)
		if match == nil {
			t.Errorf("invalid migration filename %q: expected YYYYMMDDhhmmss_description.up.sql or .down.sql", name)
			continue
		}
		version, direction := match[1], match[2]
		partner := strings.TrimSuffix(name, ".down.sql") + ".up.sql"
		if direction == "up" {
			partner = strings.TrimSuffix(name, ".up.sql") + ".down.sql"
			if previous, exists := versions[version]; exists {
				t.Errorf("duplicate migration version %s: %s and %s", version, previous, name)
			}
			versions[version] = name
		}
		if !files[partner] {
			t.Errorf("missing migration partner %s", partner)
		}
	}
}
