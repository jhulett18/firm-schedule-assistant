import { supabase } from "@/integrations/supabase/client";

export { supabase };

// Helper types
export type UserRole = 'Attorney' | 'SupportStaff' | 'Admin';
export type LocationMode = 'Zoom' | 'InPerson';
export type InPersonLocation = 'RoomA' | 'RoomB' | 'AttorneyOffice';
export type TimeOfDayPreference = 'Morning' | 'Midday' | 'Afternoon' | 'Evening' | 'None';
export type MeetingStatus = 'Draft' | 'Proposed' | 'Booked' | 'Rescheduled' | 'Cancelled' | 'Failed';
export type AuditAction = 'Created' | 'SuggestedSlots' | 'Booked' | 'Rescheduled' | 'Cancelled' | 'OverrideChange' | 'SettingsChange' | 'Failed';
export type AllowedLocationModes = 'Zoom' | 'InPerson' | 'Either';

export interface ExternalAttendee {
  name: string;
  email: string;
}

export interface MeetingPreferences {
  days_of_week?: number[];
  time_of_day?: TimeOfDayPreference;
  timezone?: string;
  weekends_allowed?: boolean;
}
