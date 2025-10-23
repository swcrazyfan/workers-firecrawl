-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  options TEXT,
  total INTEGER DEFAULT 0,
  completed INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  expires_at INTEGER
);

-- Results table
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  url TEXT NOT NULL,
  markdown TEXT,
  html TEXT,
  raw_html TEXT,
  links TEXT,
  metadata TEXT,
  json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

-- URL queue table
CREATE TABLE IF NOT EXISTS url_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  url TEXT NOT NULL,
  depth INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_results_job_id ON results(job_id);
CREATE INDEX IF NOT EXISTS idx_results_created_at ON results(created_at);
CREATE INDEX IF NOT EXISTS idx_queue_job_status ON url_queue(job_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_expires_at ON jobs(expires_at);