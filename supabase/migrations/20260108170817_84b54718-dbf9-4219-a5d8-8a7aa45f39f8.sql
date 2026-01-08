-- Add selected_calendar_ids column to calendar_connections
ALTER TABLE public.calendar_connections
ADD COLUMN IF NOT EXISTS selected_calendar_ids TEXT[] NULL;