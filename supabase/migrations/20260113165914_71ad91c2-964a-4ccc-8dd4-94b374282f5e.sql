-- Add lawmatics matter attachment decision fields to booking_requests
ALTER TABLE public.booking_requests
ADD COLUMN lawmatics_matter_mode text NOT NULL DEFAULT 'new',
ADD COLUMN lawmatics_existing_matter_id text NULL;

-- Add check constraint for valid matter mode values
ALTER TABLE public.booking_requests
ADD CONSTRAINT booking_requests_lawmatics_matter_mode_check 
CHECK (lawmatics_matter_mode IN ('new', 'existing'));

-- Add comment for documentation
COMMENT ON COLUMN public.booking_requests.lawmatics_matter_mode IS 'Admin choice for matter attachment: new (create new matter) or existing (attach to specified matter)';
COMMENT ON COLUMN public.booking_requests.lawmatics_existing_matter_id IS 'Lawmatics matter ID to attach to when mode is existing';