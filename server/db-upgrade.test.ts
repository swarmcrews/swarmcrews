import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDb } from "./db.ts";

const directories: string[] = [];
function dbPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "swarmcrews-upgrade-"));
  directories.push(directory);
  return join(directory, "server.db");
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function legacyTasks(db: Database.Database): void {
  // Older/unexpected rows must fail safely, not strand the originals behind an
  // empty replacement table that the next initialization treats as migrated.
  db.exec(`CREATE TABLE task_records (
    task_id TEXT PRIMARY KEY, leader_session_key TEXT NOT NULL,
    title TEXT, description TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'medium', executor TEXT NOT NULL DEFAULT 'leader',
    minion_session_key TEXT, status TEXT NOT NULL DEFAULT 'planned', result TEXT,
    created_at INTEGER NOT NULL, completed_at INTEGER
  );
  INSERT INTO task_records (task_id, leader_session_key, title, created_at)
    VALUES ('retained', 'leader', NULL, 1);`);
}

function schema(db: Database.Database) {
  return db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
}

describe("database upgrade failure safety", () => {
  it("rolls back failed table copies and retries without hiding legacy records", () => {
    const path = dbPath();
    const old = new Database(path);
    legacyTasks(old);
    const originalSchema = schema(old);
    const originalRows = old.prepare("SELECT * FROM task_records").all();
    old.close();

    expect(() => initDb(path)).toThrow(/NOT NULL/);
    const retained = new Database(path);
    try {
      expect(schema(retained)).toEqual(originalSchema);
      expect(retained.prepare("SELECT * FROM task_records").all()).toEqual(originalRows);
    } finally { retained.close(); }
    // A second attempt must report the same problem, not silently accept the
    // empty composite-PK table created by the previous implementation.
    expect(() => initDb(path)).toThrow(/NOT NULL/);

    const repaired = new Database(path);
    repaired.prepare("UPDATE task_records SET title = 'Recovered title'").run();
    repaired.close();
    for (let attempt = 0; attempt < 2; attempt++) {
      const migrated = initDb(path);
      try {
        expect(migrated.prepare("SELECT task_id, title FROM task_records").all())
          .toEqual([{ task_id: "retained", title: "Recovered title" }]);
      } finally { migrated.close(); }
    }
  });

  it("rolls back earlier successful migrations if a later migration fails", () => {
    const path = dbPath();
    const old = new Database(path);
    legacyTasks(old);
    old.exec(`CREATE TABLE system_model_usage (
      object_id TEXT NOT NULL, work_packet_id TEXT, used_at INTEGER NOT NULL,
      PRIMARY KEY (object_id, work_packet_id)
    );
    INSERT INTO system_model_usage VALUES ('capability.example', NULL, 1);`);
    const originalSchema = schema(old);
    const originalUsage = old.prepare("SELECT * FROM system_model_usage").all();
    old.close();

    expect(() => initDb(path)).toThrow(/NOT NULL/);
    const retained = new Database(path);
    try {
      expect(schema(retained)).toEqual(originalSchema);
      expect(retained.prepare("SELECT * FROM system_model_usage").all()).toEqual(originalUsage);
    } finally { retained.close(); }
  });

  it.each(["task_records_legacy", "system_model_usage_legacy"])(
    "refuses to hide retained records from a previously interrupted %s migration",
    (table) => {
      const path = dbPath();
      const interrupted = new Database(path);
      interrupted.exec(`CREATE TABLE ${table} (retained TEXT);
        INSERT INTO ${table} VALUES ('original records');`);
      const originalSchema = schema(interrupted);
      interrupted.close();
      expect(() => initDb(path)).toThrow(/incomplete.*migration.*back up/i);
      const retained = new Database(path);
      try {
        expect(schema(retained)).toEqual(originalSchema);
        expect(retained.prepare(`SELECT * FROM ${table}`).all())
          .toEqual([{ retained: "original records" }]);
      } finally { retained.close(); }
    },
  );

  it("closes the database handle after initialization fails", () => {
    const path = dbPath();
    const old = new Database(path);
    legacyTasks(old);
    old.close();
    const close = vi.spyOn(Database.prototype, "close");
    expect(() => initDb(path)).toThrow(/NOT NULL/);
    expect(close).toHaveBeenCalledOnce();
  });
});
