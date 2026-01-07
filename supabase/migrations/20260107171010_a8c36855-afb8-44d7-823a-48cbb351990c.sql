-- Insert additional app_settings defaults
INSERT INTO public.app_settings (key, value, description)
VALUES 
  ('business_hours_start', '09:00', 'Start of business hours (HH:MM)'),
  ('business_hours_end', '17:00', 'End of business hours (HH:MM)'),
  ('lunch_block_enabled', 'false', 'Whether to block lunch time from availability'),
  ('lunch_block_start', '12:00', 'Start of lunch block (HH:MM)'),
  ('lunch_block_end', '13:00', 'End of lunch block (HH:MM)'),
  ('min_notice_hours', '24', 'Minimum hours notice required for bookings'),
  ('default_search_window_days', '30', 'Default number of days to search for availability'),
  ('booking_request_expires_days', '7', 'Number of days before a booking request link expires')
ON CONFLICT (key) DO NOTHING;