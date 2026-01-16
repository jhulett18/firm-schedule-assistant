-- =============================================================================
-- STEP 1: Add 'Owner' to user_role enum (must be committed separately)
-- =============================================================================
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'Owner';