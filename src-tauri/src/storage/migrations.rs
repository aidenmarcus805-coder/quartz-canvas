pub const INIT_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS projects(
  id TEXT PRIMARY KEY,
  root_path TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  framework TEXT NOT NULL,
  package_manager TEXT,
  created_at TEXT NOT NULL,
  last_opened_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dev_server_configs(
  project_id TEXT PRIMARY KEY,
  command_json TEXT NOT NULL,
  approved_at TEXT,
  manifest_hash TEXT,
  last_url TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS ai_requests(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  selected_element_json TEXT,
  context_package_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  error_json TEXT
);

CREATE TABLE IF NOT EXISTS context_packages(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  ai_request_id TEXT,
  package_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS selection_records(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  project_epoch TEXT NOT NULL,
  route_fingerprint TEXT NOT NULL,
  authority_level TEXT NOT NULL,
  element_reference_json TEXT NOT NULL,
  selected_candidate_json TEXT,
  visual_capture_id TEXT,
  source_index_version TEXT,
  created_at TEXT NOT NULL,
  stale_at TEXT
);

CREATE TABLE IF NOT EXISTS patches(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  ai_request_id TEXT,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  applied_at TEXT,
  rolled_back_at TEXT
);

CREATE TABLE IF NOT EXISTS patch_files(
  id TEXT PRIMARY KEY,
  patch_id TEXT NOT NULL,
  path TEXT NOT NULL,
  operation TEXT NOT NULL,
  before_hash TEXT,
  after_hash TEXT,
  rollback_blob_path TEXT,
  FOREIGN KEY(patch_id) REFERENCES patches(id)
);

CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_session(
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token TEXT NOT NULL,
  user_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_profiles(
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  role TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
"#;
