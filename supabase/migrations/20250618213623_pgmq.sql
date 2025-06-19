
CREATE extension IF NOT EXISTS pgmq CASCADE;
SELECT pgmq.create('image-processing');
