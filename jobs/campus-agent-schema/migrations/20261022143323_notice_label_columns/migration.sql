-- Internal notices get two orthogonal labels: label_category (the business
-- topic) and label_intent (what the reader is asked to do). External notices
-- are not classified. The old category column keeps serving readers until the
-- second release switches them over and drops it.
ALTER TABLE notices.notices ADD COLUMN label_category text;

ALTER TABLE notices.notices ADD COLUMN label_intent text;

ALTER TABLE notices.notices ADD CONSTRAINT notices_label_category_check CHECK (
    label_category IN (
        'procurement', 'competition', 'lecture_forum', 'training', 'application',
        'recruitment', 'international', 'selection_result', 'examination', 'service_info',
        'teaching_schedule', 'activity', 'news', 'affairs', 'governance'
    )
);

ALTER TABLE notices.notices ADD CONSTRAINT notices_label_intent_check CHECK (
    label_intent IN ('action', 'event', 'notice', 'result', 'reference')
);

ALTER TABLE notices.notices ADD CONSTRAINT notices_label_pair_check CHECK (
    (label_category IS NULL) = (label_intent IS NULL)
);

ALTER TABLE notices.notices ADD CONSTRAINT notices_label_internal_check CHECK (
    NOT is_external OR label_category IS NULL
);
