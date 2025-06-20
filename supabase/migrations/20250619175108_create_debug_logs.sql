CREATE TABLE debug_logs (
  id SERIAL PRIMARY KEY,
  message TEXT,
  created_at TIMESTAMP DEFAULT now()
);

