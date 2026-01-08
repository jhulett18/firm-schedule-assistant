-- Insert the availability_busy_source setting with default "freebusy"
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'availability_busy_source',
  'freebusy',
  'Busy source for availability calculations. freebusy uses Google FreeBusy API, events computes busy from Events API (stricter, catches transparent events).'
)
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description;