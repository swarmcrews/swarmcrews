import type Database from "better-sqlite3";

// Invoked inside initDb's single upgrade transaction.
export function ensureTaskRecordsCompositePk(db: Database.Database): void {
  const rows = db.pragma("table_info(task_records)") as Array<{
    name: string;
    type: string;
    pk: number;
  }>;
  const taskId = rows.find((r) => r.name === "task_id");
  const leader = rows.find((r) => r.name === "leader_session_key");
  if (taskId?.pk && leader?.pk) return;

  const collision = db
    .prepare(
      `SELECT leader_session_key, task_id, COUNT(*) AS count
       FROM task_records
       GROUP BY leader_session_key, task_id
       HAVING count > 1
       LIMIT 1`,
    )
    .get() as { leader_session_key: string; task_id: string; count: number } | undefined;
  if (collision) {
    throw new Error(
      `Cannot migrate task_records: duplicate task ${collision.task_id} for leader ${collision.leader_session_key}`,
    );
  }

  db.exec(`
    ALTER TABLE task_records RENAME TO task_records_legacy;
    CREATE TABLE task_records (
      task_id            TEXT NOT NULL,
      leader_session_key TEXT NOT NULL,
      title              TEXT NOT NULL,
      description        TEXT NOT NULL DEFAULT '',
      priority           TEXT NOT NULL DEFAULT 'medium',
      executor           TEXT NOT NULL DEFAULT 'leader',
      minion_session_key TEXT,
      status             TEXT NOT NULL DEFAULT 'planned',
      result             TEXT,
      created_at         INTEGER NOT NULL,
      completed_at       INTEGER,
      PRIMARY KEY (leader_session_key, task_id)
    );
    INSERT INTO task_records (
      task_id, leader_session_key, title, description, priority,
      executor, minion_session_key, status, result, created_at, completed_at
    )
    SELECT
      task_id, leader_session_key, title, description, priority,
      executor, minion_session_key, status, result, created_at, completed_at
    FROM task_records_legacy;
    DROP TABLE task_records_legacy;
  `);
}

export function ensureSystemModelUsageSchema(db: Database.Database): void {
  const rows = db.pragma("table_info(system_model_usage)") as Array<{
    name: string;
    pk: number;
  }>;
  const pk = rows
    .filter((row) => row.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((row) => row.name);
  const hasNewColumns =
    rows.some((row) => row.name === "source") &&
    rows.some((row) => row.name === "session_key");
  const hasNewPk =
    pk.join(",") === "object_id,work_packet_id,source,session_key";
  if (hasNewColumns && hasNewPk) return;
  if (!rows.some((row) => row.name === "source")) {
    ensureColumn(db, "system_model_usage", "source", "TEXT NOT NULL DEFAULT 'packet'");
  }
  if (!rows.some((row) => row.name === "session_key")) {
    ensureColumn(db, "system_model_usage", "session_key", "TEXT NOT NULL DEFAULT ''");
  }

  db.exec(`
    ALTER TABLE system_model_usage RENAME TO system_model_usage_legacy;
    CREATE TABLE system_model_usage (
      object_id       TEXT NOT NULL,
      work_packet_id  TEXT NOT NULL DEFAULT '',
      source          TEXT NOT NULL DEFAULT 'packet',
      session_key     TEXT NOT NULL DEFAULT '',
      used_at         INTEGER NOT NULL,
      PRIMARY KEY (object_id, work_packet_id, source, session_key)
    );
    INSERT OR REPLACE INTO system_model_usage (
      object_id, work_packet_id, source, session_key, used_at
    )
    SELECT
      object_id,
      COALESCE(work_packet_id, ''),
      COALESCE(source, 'packet'),
      COALESCE(session_key, ''),
      MAX(used_at)
    FROM system_model_usage_legacy
    GROUP BY
      object_id,
      COALESCE(work_packet_id, ''),
      COALESCE(source, 'packet'),
      COALESCE(session_key, '');
    DROP TABLE system_model_usage_legacy;
  `);
}

/**
 * Add `column` of `type` to `table` if it doesn't already exist.
 * SQLite doesn't support `ADD COLUMN IF NOT EXISTS`, so we inspect
 * `PRAGMA table_info` first.
 */
export function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  type: string,
): void {
  const rows = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (rows.some((r) => r.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
