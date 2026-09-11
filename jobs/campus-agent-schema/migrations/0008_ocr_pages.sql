CREATE TABLE ocr.pages (
    task_id uuid NOT NULL REFERENCES ocr.tasks (id) ON DELETE CASCADE,
    page_index integer NOT NULL CHECK (page_index >= 0),
    markdown text NOT NULL,
    images text[] NOT NULL DEFAULT '{}',
    PRIMARY KEY (task_id, page_index)
);
--> statement-breakpoint
GRANT SELECT ON ocr.pages TO ops_web;
GRANT SELECT, INSERT, UPDATE, DELETE ON ocr.pages TO campus_agent;
