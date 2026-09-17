-- Formal menu-item reviews are permanent content: only user-submission review
-- history and reports keep the 30-day retention.
UPDATE dining.review_edits edit
SET expires_at = NULL
WHERE EXISTS (
    SELECT 1
    FROM dining.reviews review
    WHERE
        review.review_id = edit.review_id
        AND review.menu_item_id IS NOT NULL
);

UPDATE dining.review_reports report
SET content_expires_at = NULL
WHERE EXISTS (
    SELECT 1
    FROM dining.reviews review
    WHERE
        review.review_id = report.review_id
        AND review.menu_item_id IS NOT NULL
);
