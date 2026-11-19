import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type { AppPaths } from '../paths'

export type Db = Database.Database

export const SCHEMA_VERSION = 1

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('prompt', 'contract', 'skill', 'mcp')),
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  folder TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  sync_policy TEXT NOT NULL DEFAULT 'inherit'
    CHECK (sync_policy IN ('inherit', 'sync', 'local')),
  source TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (kind, folder, slug)
);

CREATE INDEX IF NOT EXISTS idx_assets_kind_folder ON assets (kind, folder);
CREATE INDEX IF NOT EXISTS idx_assets_updated ON assets (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_deleted ON assets (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS asset_revisions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  note TEXT,
  manifest_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (asset_id, version)
);

CREATE INDEX IF NOT EXISTS idx_revisions_asset ON asset_revisions (asset_id, version DESC);

CREATE TABLE IF NOT EXISTS asset_files (
  revision_id TEXT NOT NULL REFERENCES asset_revisions(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  blob_hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  media_kind TEXT NOT NULL DEFAULT 'text'
    CHECK (media_kind IN ('text', 'binary')),
  is_executable INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (revision_id, path)
);

CREATE TABLE IF NOT EXISTS prompts (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  system_prompt TEXT NOT NULL DEFAULT '',
  user_prompt TEXT NOT NULL DEFAULT '',
  variables_json TEXT NOT NULL DEFAULT '[]',
  usage_count INTEGER NOT NULL DEFAULT 0,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS contracts (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL CHECK (scope IN ('user', 'project', 'path')),
  path_prefix TEXT,
  activation_json TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  imports_json TEXT NOT NULL DEFAULT '[]',
  target_ids_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS skills (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  version_label TEXT NOT NULL DEFAULT '1.0.0',
  author TEXT,
  category TEXT,
  icon TEXT
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  transport TEXT NOT NULL CHECK (transport IN ('stdio', 'http')),
  command TEXT,
  args_json TEXT NOT NULL DEFAULT '[]',
  url TEXT,
  env_json TEXT NOT NULL DEFAULT '{}',
  headers_json TEXT NOT NULL DEFAULT '{}',
  required_env_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  health_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS secrets (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('mcp_env', 'mcp_header', 'ai_key', 'git_token')),
  owner_id TEXT NOT NULL,
  key TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_type, owner_id, key)
);

CREATE TABLE IF NOT EXISTS tags (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (asset_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags (tag);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repos (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'gitlab', 'generic')),
  url TEXT NOT NULL,
  branch TEXT NOT NULL,
  local_path TEXT NOT NULL,
  auth_mode TEXT NOT NULL CHECK (auth_mode IN ('credential', 'ssh', 'token')),
  clone_mode TEXT NOT NULL CHECK (clone_mode IN ('managed', 'bound')),
  policies_json TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  auto_fetch INTEGER NOT NULL DEFAULT 0,
  fetch_interval_min INTEGER NOT NULL DEFAULT 15,
  push_mode TEXT NOT NULL DEFAULT 'direct'
    CHECK (push_mode IN ('direct', 'branch')),
  last_fetched_at TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repo_assets (
  repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  remote_path TEXT NOT NULL,
  base_commit TEXT,
  base_revision_id TEXT REFERENCES asset_revisions(id),
  base_manifest_hash TEXT,
  last_synced_at TEXT,
  PRIMARY KEY (repo_id, asset_id)
);

CREATE TABLE IF NOT EXISTS sync_changes (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  asset_kind TEXT NOT NULL CHECK (asset_kind IN ('prompt', 'contract', 'skill', 'mcp')),
  asset_name TEXT NOT NULL,
  remote_path TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing', 'conflict')),
  change_kind TEXT NOT NULL CHECK (change_kind IN ('added', 'modified', 'deleted', 'renamed')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewed', 'resolved', 'dismissed')),
  risk_json TEXT NOT NULL DEFAULT '[]',
  fingerprint TEXT NOT NULL,
  local_revision_id TEXT REFERENCES asset_revisions(id),
  base_revision_id TEXT REFERENCES asset_revisions(id),
  remote_commit TEXT,
  remote_blob_hash TEXT,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (repo_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_sync_changes_repo ON sync_changes (repo_id, direction, status);

CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('started', 'writing', 'committed', 'failed', 'cancelled')),
  repo_id TEXT,
  asset_id TEXT,
  target_path TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_operations_state ON operations (state, started_at);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  detected INTEGER NOT NULL DEFAULT 0,
  detected_at TEXT,
  skill_dir TEXT,
  mcp_file TEXT,
  supports_skills INTEGER NOT NULL DEFAULT 0,
  supports_mcp INTEGER NOT NULL DEFAULT 0,
  config_format TEXT
);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  asset_kind TEXT NOT NULL CHECK (asset_kind IN ('skill', 'mcp')),
  agent_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('symlink', 'copy')),
  status TEXT NOT NULL CHECK (status IN ('synced', 'stale', 'drifted', 'missing')),
  target_path TEXT NOT NULL,
  deployed_revision_id TEXT REFERENCES asset_revisions(id),
  previous_revision_id TEXT REFERENCES asset_revisions(id),
  manifest_hash TEXT NOT NULL,
  managed_keys_json TEXT NOT NULL DEFAULT '[]',
  deployed_at TEXT NOT NULL,
  note TEXT,
  UNIQUE (asset_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_deployments_agent ON deployments (agent_id, status);

CREATE TABLE IF NOT EXISTS projections (
  id TEXT PRIMARY KEY,
  contract_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  contract_title TEXT,
  contract_slug TEXT,
  target_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('project', 'global')),
  project_id TEXT NOT NULL DEFAULT '',
  target_path TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('synced', 'stale', 'drifted', 'missing')),
  deployed_revision_id TEXT REFERENCES asset_revisions(id),
  previous_revision_id TEXT REFERENCES asset_revisions(id),
  file_hash TEXT,
  outside_hash TEXT,
  block_hash TEXT,
  deployed_at TEXT,
  note TEXT,
  orphaned INTEGER NOT NULL DEFAULT 0,
  CHECK (
    (scope = 'global' AND project_id = '') OR
    (scope = 'project' AND project_id <> '')
  )
);

CREATE INDEX IF NOT EXISTS idx_projections_contract ON projections (contract_id);
CREATE INDEX IF NOT EXISTS idx_projections_target ON projections (target_id, scope, project_id);

CREATE TABLE IF NOT EXISTS global_targets (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  label TEXT NOT NULL,
  path_mode TEXT NOT NULL CHECK (path_mode IN ('file', 'dir')),
  path TEXT NOT NULL,
  default_path TEXT NOT NULL,
  format TEXT NOT NULL,
  merge_mode TEXT NOT NULL CHECK (merge_mode IN ('single-file', 'per-contract')),
  file_ext TEXT,
  supports_json TEXT NOT NULL,
  max_bytes INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('success', 'warning', 'error')),
  title TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  asset_id TEXT,
  target_id TEXT,
  repo_id TEXT,
  operation_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_events (at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_events (type, at DESC);

CREATE TABLE IF NOT EXISTS idempotency (
  request_id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  key_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_id TEXT,
  started_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'cancelled', 'failed')),
  response_preview TEXT NOT NULL,
  error_code TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(
  asset_id UNINDEXED,
  kind UNINDEXED,
  title,
  description,
  body,
  tags,
  path,
  tokenize = 'unicode61'
);
`

const MIGRATIONS: Array<{ version: number; name: string; sql: string }> = [
  { version: 1, name: 'initial_desktop_schema', sql: SCHEMA_V1 },
]

export function openDatabase(paths: AppPaths): Db {
  mkdirSync(dirname(paths.dbFile), { recursive: true })
  const db = new Database(paths.dbFile)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('temp_store = MEMORY')
  db.pragma('wal_autocheckpoint = 1000')
  migrate(db)
  return db
}

export function migrate(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`)
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((row) => (row as { version: number }).version),
  )
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue
    const tx = db.transaction(() => {
      db.exec(migration.sql)
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      )
    })
    tx()
  }
}

export function currentSchemaVersion(db: Db): number {
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as
    | { version: number | null }
    | undefined
  return row?.version ?? 0
}
