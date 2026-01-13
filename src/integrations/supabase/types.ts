export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          created_at: string
          description: string | null
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          description?: string | null
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action_type: Database["public"]["Enums"]["audit_action"]
          actor_user_id: string | null
          created_at: string
          details_json: Json
          id: string
          meeting_id: string | null
        }
        Insert: {
          action_type: Database["public"]["Enums"]["audit_action"]
          actor_user_id?: string | null
          created_at?: string
          details_json?: Json
          id?: string
          meeting_id?: string | null
        }
        Update: {
          action_type?: Database["public"]["Enums"]["audit_action"]
          actor_user_id?: string | null
          created_at?: string
          details_json?: Json
          id?: string
          meeting_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_progress_logs: {
        Row: {
          created_at: string
          details_json: Json | null
          id: string
          level: string
          meeting_id: string | null
          message: string
          run_id: string
          step: string
        }
        Insert: {
          created_at?: string
          details_json?: Json | null
          id?: string
          level?: string
          meeting_id?: string | null
          message: string
          run_id: string
          step: string
        }
        Update: {
          created_at?: string
          details_json?: Json | null
          id?: string
          level?: string
          meeting_id?: string | null
          message?: string
          run_id?: string
          step?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_progress_logs_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_requests: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          lawmatics_existing_matter_id: string | null
          lawmatics_matter_mode: string
          meeting_id: string
          public_token: string
          status: Database["public"]["Enums"]["booking_request_status"]
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          lawmatics_existing_matter_id?: string | null
          lawmatics_matter_mode?: string
          meeting_id: string
          public_token?: string
          status?: Database["public"]["Enums"]["booking_request_status"]
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          lawmatics_existing_matter_id?: string | null
          lawmatics_matter_mode?: string
          meeting_id?: string
          public_token?: string
          status?: Database["public"]["Enums"]["booking_request_status"]
        }
        Relationships: [
          {
            foreignKeyName: "booking_requests_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_connections: {
        Row: {
          access_token: string
          created_at: string
          id: string
          last_calendar_list_count: number | null
          last_verified_at: string | null
          last_verified_error: string | null
          last_verified_ok: boolean | null
          provider: Database["public"]["Enums"]["calendar_provider"]
          refresh_token: string | null
          resource_email: string | null
          scopes: string[] | null
          selected_calendar_ids: string[] | null
          token_expires_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          access_token: string
          created_at?: string
          id?: string
          last_calendar_list_count?: number | null
          last_verified_at?: string | null
          last_verified_error?: string | null
          last_verified_ok?: boolean | null
          provider: Database["public"]["Enums"]["calendar_provider"]
          refresh_token?: string | null
          resource_email?: string | null
          scopes?: string[] | null
          selected_calendar_ids?: string[] | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          access_token?: string
          created_at?: string
          id?: string
          last_calendar_list_count?: number | null
          last_verified_at?: string | null
          last_verified_error?: string | null
          last_verified_ok?: boolean | null
          provider?: Database["public"]["Enums"]["calendar_provider"]
          refresh_token?: string | null
          resource_email?: string | null
          scopes?: string[] | null
          selected_calendar_ids?: string[] | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      lawmatics_connections: {
        Row: {
          access_token: string
          connected_at: string | null
          connected_by_user_id: string | null
          id: string
          updated_at: string | null
        }
        Insert: {
          access_token: string
          connected_at?: string | null
          connected_by_user_id?: string | null
          id?: string
          updated_at?: string | null
        }
        Update: {
          access_token?: string
          connected_at?: string | null
          connected_by_user_id?: string | null
          id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lawmatics_connections_connected_by_user_id_fkey"
            columns: ["connected_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      lawmatics_reference_data: {
        Row: {
          data: Json
          fetched_at: string
          key: string
        }
        Insert: {
          data?: Json
          fetched_at?: string
          key: string
        }
        Update: {
          data?: Json
          fetched_at?: string
          key?: string
        }
        Relationships: []
      }
      meeting_google_events: {
        Row: {
          created_at: string
          google_calendar_id: string
          google_event_id: string
          id: string
          meeting_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          google_calendar_id: string
          google_event_id: string
          id?: string
          meeting_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          google_calendar_id?: string
          google_event_id?: string
          id?: string
          meeting_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_google_events_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_google_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_types: {
        Row: {
          active: boolean
          allowed_location_modes: Database["public"]["Enums"]["allowed_location_modes"]
          created_at: string
          id: string
          lawmatics_event_type_id: string | null
          name: string
          title_template: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          allowed_location_modes?: Database["public"]["Enums"]["allowed_location_modes"]
          created_at?: string
          id?: string
          lawmatics_event_type_id?: string | null
          name: string
          title_template?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          allowed_location_modes?: Database["public"]["Enums"]["allowed_location_modes"]
          created_at?: string
          id?: string
          lawmatics_event_type_id?: string | null
          name?: string
          title_template?: string
          updated_at?: string
        }
        Relationships: []
      }
      meetings: {
        Row: {
          booking_request_id: string | null
          client_email: string | null
          created_at: string
          created_by_user_id: string | null
          duration_minutes: number
          end_datetime: string | null
          external_attendees: Json
          google_calendar_id: string | null
          google_event_id: string | null
          host_attorney_user_id: string | null
          id: string
          in_person_location_choice:
            | Database["public"]["Enums"]["in_person_location"]
            | null
          lawmatics_appointment_id: string | null
          lawmatics_contact_id: string | null
          lawmatics_matter_id: string | null
          location_mode: Database["public"]["Enums"]["location_mode"]
          m365_event_id: string | null
          meeting_type_id: string | null
          override_mode_used: boolean
          participant_user_ids: string[]
          preferences: Json
          room_id: string | null
          search_window_days_used: number
          start_datetime: string | null
          status: Database["public"]["Enums"]["meeting_status"]
          support_user_ids: string[]
          timezone: string
          updated_at: string
          zoom_join_url: string | null
          zoom_meeting_id: string | null
        }
        Insert: {
          booking_request_id?: string | null
          client_email?: string | null
          created_at?: string
          created_by_user_id?: string | null
          duration_minutes?: number
          end_datetime?: string | null
          external_attendees?: Json
          google_calendar_id?: string | null
          google_event_id?: string | null
          host_attorney_user_id?: string | null
          id?: string
          in_person_location_choice?:
            | Database["public"]["Enums"]["in_person_location"]
            | null
          lawmatics_appointment_id?: string | null
          lawmatics_contact_id?: string | null
          lawmatics_matter_id?: string | null
          location_mode?: Database["public"]["Enums"]["location_mode"]
          m365_event_id?: string | null
          meeting_type_id?: string | null
          override_mode_used?: boolean
          participant_user_ids?: string[]
          preferences?: Json
          room_id?: string | null
          search_window_days_used?: number
          start_datetime?: string | null
          status?: Database["public"]["Enums"]["meeting_status"]
          support_user_ids?: string[]
          timezone?: string
          updated_at?: string
          zoom_join_url?: string | null
          zoom_meeting_id?: string | null
        }
        Update: {
          booking_request_id?: string | null
          client_email?: string | null
          created_at?: string
          created_by_user_id?: string | null
          duration_minutes?: number
          end_datetime?: string | null
          external_attendees?: Json
          google_calendar_id?: string | null
          google_event_id?: string | null
          host_attorney_user_id?: string | null
          id?: string
          in_person_location_choice?:
            | Database["public"]["Enums"]["in_person_location"]
            | null
          lawmatics_appointment_id?: string | null
          lawmatics_contact_id?: string | null
          lawmatics_matter_id?: string | null
          location_mode?: Database["public"]["Enums"]["location_mode"]
          m365_event_id?: string | null
          meeting_type_id?: string | null
          override_mode_used?: boolean
          participant_user_ids?: string[]
          preferences?: Json
          room_id?: string | null
          search_window_days_used?: number
          start_datetime?: string | null
          status?: Database["public"]["Enums"]["meeting_status"]
          support_user_ids?: string[]
          timezone?: string
          updated_at?: string
          zoom_join_url?: string | null
          zoom_meeting_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meetings_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_host_attorney_user_id_fkey"
            columns: ["host_attorney_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_meeting_type_id_fkey"
            columns: ["meeting_type_id"]
            isOneToOne: false
            referencedRelation: "meeting_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      pairing_presets: {
        Row: {
          active: boolean
          attorney_user_id: string
          created_at: string
          created_by_user_id: string | null
          id: string
          meeting_type_id: string | null
          name: string
          support_user_ids: string[]
          updated_at: string
        }
        Insert: {
          active?: boolean
          attorney_user_id: string
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          meeting_type_id?: string | null
          name: string
          support_user_ids?: string[]
          updated_at?: string
        }
        Update: {
          active?: boolean
          attorney_user_id?: string
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          meeting_type_id?: string | null
          name?: string
          support_user_ids?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pairing_presets_attorney_user_id_fkey"
            columns: ["attorney_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pairing_presets_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pairing_presets_meeting_type_id_fkey"
            columns: ["meeting_type_id"]
            isOneToOne: false
            referencedRelation: "meeting_types"
            referencedColumns: ["id"]
          },
        ]
      }
      recent_pairings: {
        Row: {
          attorney_user_id: string
          id: string
          meeting_type_id: string | null
          support_user_ids: string[]
          used_at: string
          user_id: string
        }
        Insert: {
          attorney_user_id: string
          id?: string
          meeting_type_id?: string | null
          support_user_ids?: string[]
          used_at?: string
          user_id: string
        }
        Update: {
          attorney_user_id?: string
          id?: string
          meeting_type_id?: string | null
          support_user_ids?: string[]
          used_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recent_pairings_attorney_user_id_fkey"
            columns: ["attorney_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recent_pairings_meeting_type_id_fkey"
            columns: ["meeting_type_id"]
            isOneToOne: false
            referencedRelation: "meeting_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recent_pairings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          active: boolean
          created_at: string
          id: string
          lawmatics_location_id: string | null
          name: string
          resource_email: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          lawmatics_location_id?: string | null
          name: string
          resource_email: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          lawmatics_location_id?: string | null
          name?: string
          resource_email?: string
          updated_at?: string
        }
        Relationships: []
      }
      scheduler_mappings: {
        Row: {
          active: boolean
          booking_link_template: string | null
          created_at: string
          duration_minutes: number
          host_attorney_user_id: string
          id: string
          lawmatics_scheduler_id: string | null
          location_mode: Database["public"]["Enums"]["location_mode"]
          meeting_type_id: string
          room_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          booking_link_template?: string | null
          created_at?: string
          duration_minutes: number
          host_attorney_user_id: string
          id?: string
          lawmatics_scheduler_id?: string | null
          location_mode: Database["public"]["Enums"]["location_mode"]
          meeting_type_id: string
          room_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          booking_link_template?: string | null
          created_at?: string
          duration_minutes?: number
          host_attorney_user_id?: string
          id?: string
          lawmatics_scheduler_id?: string | null
          location_mode?: Database["public"]["Enums"]["location_mode"]
          meeting_type_id?: string
          room_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduler_mappings_host_attorney_user_id_fkey"
            columns: ["host_attorney_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduler_mappings_meeting_type_id_fkey"
            columns: ["meeting_type_id"]
            isOneToOne: false
            referencedRelation: "meeting_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduler_mappings_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          active: boolean
          auth_user_id: string | null
          company_id: string
          created_at: string
          default_search_window_days: number
          email: string
          id: string
          max_search_window_days: number
          name: string
          role: Database["public"]["Enums"]["user_role"]
          timezone_default: string
          updated_at: string
          weekends_allowed_default: boolean
          zoom_access_token: string | null
          zoom_oauth_connected: boolean
          zoom_refresh_token: string | null
          zoom_user_id: string | null
        }
        Insert: {
          active?: boolean
          auth_user_id?: string | null
          company_id?: string
          created_at?: string
          default_search_window_days?: number
          email: string
          id?: string
          max_search_window_days?: number
          name: string
          role?: Database["public"]["Enums"]["user_role"]
          timezone_default?: string
          updated_at?: string
          weekends_allowed_default?: boolean
          zoom_access_token?: string | null
          zoom_oauth_connected?: boolean
          zoom_refresh_token?: string | null
          zoom_user_id?: string | null
        }
        Update: {
          active?: boolean
          auth_user_id?: string | null
          company_id?: string
          created_at?: string
          default_search_window_days?: number
          email?: string
          id?: string
          max_search_window_days?: number
          name?: string
          role?: Database["public"]["Enums"]["user_role"]
          timezone_default?: string
          updated_at?: string
          weekends_allowed_default?: boolean
          zoom_access_token?: string | null
          zoom_oauth_connected?: boolean
          zoom_refresh_token?: string | null
          zoom_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_current_user_company_id: { Args: never; Returns: string }
      get_current_user_internal_id: { Args: never; Returns: string }
      has_admin_role: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_staff_role: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      allowed_location_modes: "Zoom" | "InPerson" | "Either"
      app_role: "admin" | "staff" | "client"
      audit_action:
        | "Created"
        | "SuggestedSlots"
        | "Booked"
        | "Rescheduled"
        | "Cancelled"
        | "OverrideChange"
        | "SettingsChange"
        | "Failed"
      booking_request_status: "Open" | "Completed" | "Expired"
      calendar_provider: "google" | "microsoft"
      in_person_location: "RoomA" | "RoomB" | "AttorneyOffice"
      location_mode: "Zoom" | "InPerson"
      meeting_status:
        | "Draft"
        | "Proposed"
        | "Booked"
        | "Rescheduled"
        | "Cancelled"
        | "Failed"
      time_of_day_preference:
        | "Morning"
        | "Midday"
        | "Afternoon"
        | "Evening"
        | "None"
      user_role: "Attorney" | "SupportStaff" | "Admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      allowed_location_modes: ["Zoom", "InPerson", "Either"],
      app_role: ["admin", "staff", "client"],
      audit_action: [
        "Created",
        "SuggestedSlots",
        "Booked",
        "Rescheduled",
        "Cancelled",
        "OverrideChange",
        "SettingsChange",
        "Failed",
      ],
      booking_request_status: ["Open", "Completed", "Expired"],
      calendar_provider: ["google", "microsoft"],
      in_person_location: ["RoomA", "RoomB", "AttorneyOffice"],
      location_mode: ["Zoom", "InPerson"],
      meeting_status: [
        "Draft",
        "Proposed",
        "Booked",
        "Rescheduled",
        "Cancelled",
        "Failed",
      ],
      time_of_day_preference: [
        "Morning",
        "Midday",
        "Afternoon",
        "Evening",
        "None",
      ],
      user_role: ["Attorney", "SupportStaff", "Admin"],
    },
  },
} as const
