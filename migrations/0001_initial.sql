CREATE TABLE IF NOT EXISTS attendance (
  date TEXT PRIMARY KEY NOT NULL,
  clock_in TEXT,
  clock_out TEXT,
  updated_at TEXT NOT NULL
);
