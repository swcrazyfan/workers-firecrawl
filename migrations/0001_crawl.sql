CREATE TABLE IF NOT EXISTS crawl_jobs (
  id TEXT PRIMARY KEY, url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scraping',
  options TEXT, error TEXT, total INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS crawl_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, url TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL,
  UNIQUE(job_id, url)
);
CREATE TABLE IF NOT EXISTS crawl_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, url TEXT NOT NULL,
  status TEXT NOT NULL, status_code INTEGER, markdown TEXT, html TEXT, raw_html TEXT,
  links TEXT, metadata TEXT, json TEXT, error TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crawl_queue_job_status ON crawl_queue(job_id, status);
CREATE INDEX IF NOT EXISTS idx_crawl_results_job_id ON crawl_results(job_id, id);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_expires ON crawl_jobs(expires_at);
