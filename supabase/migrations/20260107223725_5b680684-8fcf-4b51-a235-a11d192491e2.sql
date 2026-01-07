-- Add verification columns to calendar_connections
ALTER TABLE public.calendar_connections
ADD COLUMN IF NOT EXISTS last_verified_at timestamptz NULL,
ADD COLUMN IF NOT EXISTS last_verified_ok boolean NULL,
ADD COLUMN IF NOT EXISTS last_verified_error text NULL,
ADD COLUMN IF NOT EXISTS last_calendar_list_count integer NULL;