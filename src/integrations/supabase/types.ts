export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      departments: {
        Row: {
          id: string;
          name: string;
          code: string | null;
          head_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          code?: string | null;
          head_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          code?: string | null;
          head_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      labs: {
        Row: {
          id: string;
          name: string;
          department_id: string | null;
          location: string | null;
          incharge_id: string | null;
          capacity: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          department_id?: string | null;
          location?: string | null;
          incharge_id?: string | null;
          capacity?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          department_id?: string | null;
          location?: string | null;
          incharge_id?: string | null;
          capacity?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      institution_settings: {
        Row: {
          id: boolean;
          name: string;
          short_name: string | null;
          academic_year: string | null;
          semester_label: string | null;
          semester_start: string | null;
          semester_end: string | null;
          min_attendance_pct: number;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          id?: boolean;
          name?: string;
          short_name?: string | null;
          academic_year?: string | null;
          semester_label?: string | null;
          semester_start?: string | null;
          semester_end?: string | null;
          min_attendance_pct?: number;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          id?: boolean;
          name?: string;
          short_name?: string | null;
          academic_year?: string | null;
          semester_label?: string | null;
          semester_start?: string | null;
          semester_end?: string | null;
          min_attendance_pct?: number;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      schedule_slots: {
        Row: {
          id: string;
          project_id: string;
          title: string;
          kind: string;
          starts_at: string;
          ends_at: string;
          location: string | null;
          lab_id: string | null;
          notes: string | null;
          series_id: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          title: string;
          kind?: string;
          starts_at: string;
          ends_at: string;
          location?: string | null;
          lab_id?: string | null;
          notes?: string | null;
          series_id?: string | null;
          created_by?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          title?: string;
          kind?: string;
          starts_at?: string;
          ends_at?: string;
          location?: string | null;
          lab_id?: string | null;
          notes?: string | null;
          series_id?: string | null;
          created_by?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "schedule_slots_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          id: number;
          at: string;
          actor_id: string | null;
          action: string;
          entity: string;
          entity_id: string | null;
          details: Json;
        };
        Insert: {
          id?: number;
          at?: string;
          actor_id?: string | null;
          action: string;
          entity: string;
          entity_id?: string | null;
          details?: Json;
        };
        Update: {
          id?: number;
          at?: string;
          actor_id?: string | null;
          action?: string;
          entity?: string;
          entity_id?: string | null;
          details?: Json;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          kind: string;
          title: string;
          body: string | null;
          link: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          kind: string;
          title: string;
          body?: string | null;
          link?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          kind?: string;
          title?: string;
          body?: string | null;
          link?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          college_id: string | null;
          created_at: string;
          department: string | null;
          department_id: string | null;
          full_name: string;
          id: string;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          college_id?: string | null;
          created_at?: string;
          department?: string | null;
          department_id?: string | null;
          full_name?: string;
          id: string;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          college_id?: string | null;
          created_at?: string;
          department?: string | null;
          department_id?: string | null;
          full_name?: string;
          id?: string;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      project_members: {
        Row: {
          id: string;
          joined_at: string;
          project_id: string;
          student_id: string;
        };
        Insert: {
          id?: string;
          joined_at?: string;
          project_id: string;
          student_id: string;
        };
        Update: {
          id?: string;
          joined_at?: string;
          project_id?: string;
          student_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      projects: {
        Row: {
          created_at: string;
          description: string | null;
          end_date: string | null;
          faculty_id: string;
          id: string;
          lab_name: string | null;
          objectives: string | null;
          required_hours: number;
          start_date: string | null;
          status: Database["public"]["Enums"]["project_status"];
          title: string;
          updated_at: string;
          department_id: string | null;
          lab_id: string | null;
          co_supervisor_id: string | null;
          domain: string | null;
          keywords: string[];
          funding_source: string | null;
          max_members: number | null;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          end_date?: string | null;
          faculty_id: string;
          id?: string;
          lab_name?: string | null;
          objectives?: string | null;
          required_hours?: number;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["project_status"];
          title: string;
          updated_at?: string;
          department_id?: string | null;
          lab_id?: string | null;
          co_supervisor_id?: string | null;
          domain?: string | null;
          keywords?: string[];
          funding_source?: string | null;
          max_members?: number | null;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          end_date?: string | null;
          faculty_id?: string;
          id?: string;
          lab_name?: string | null;
          objectives?: string | null;
          required_hours?: number;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["project_status"];
          title?: string;
          updated_at?: string;
          department_id?: string | null;
          lab_id?: string | null;
          co_supervisor_id?: string | null;
          domain?: string | null;
          keywords?: string[];
          funding_source?: string | null;
          max_members?: number | null;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      submissions: {
        Row: {
          comment: string | null;
          created_at: string;
          faculty_comment: string | null;
          file_name: string;
          file_path: string;
          id: string;
          project_id: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database["public"]["Enums"]["submission_status"];
          student_id: string;
        };
        Insert: {
          comment?: string | null;
          created_at?: string;
          faculty_comment?: string | null;
          file_name: string;
          file_path: string;
          id?: string;
          project_id: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["submission_status"];
          student_id: string;
        };
        Update: {
          comment?: string | null;
          created_at?: string;
          faculty_comment?: string | null;
          file_name?: string;
          file_path?: string;
          id?: string;
          project_id?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["submission_status"];
          student_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "submissions_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      work_sessions: {
        Row: {
          check_in_at: string;
          check_out_at: string | null;
          created_at: string;
          duration_minutes: number | null;
          id: string;
          notes: string | null;
          project_id: string;
          remarks: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database["public"]["Enums"]["session_status"];
          student_id: string;
          submitted_at: string | null;
          summary: string | null;
          updated_at: string;
        };
        Insert: {
          check_in_at?: string;
          check_out_at?: string | null;
          created_at?: string;
          duration_minutes?: number | null;
          id?: string;
          notes?: string | null;
          project_id: string;
          remarks?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["session_status"];
          student_id: string;
          submitted_at?: string | null;
          summary?: string | null;
          updated_at?: string;
        };
        Update: {
          check_in_at?: string;
          check_out_at?: string | null;
          created_at?: string;
          duration_minutes?: number | null;
          id?: string;
          notes?: string | null;
          project_id?: string;
          remarks?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["session_status"];
          student_id?: string;
          submitted_at?: string | null;
          summary?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_sessions_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      admin_list_users: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          email: string;
          full_name: string;
          college_id: string | null;
          role: Database["public"]["Enums"]["app_role"];
          department_id: string | null;
          created_at: string;
          last_sign_in_at: string | null;
        }[];
      };
      admin_faculty_allowlist: {
        Args: { add_email?: string; remove_email?: string };
        Returns: string[];
      };
      attendance_recommendations: {
        Args: { p_project?: string };
        Returns: {
          student_id: string;
          project_id: string;
          verified_minutes: number;
          pending_minutes: number;
          required_hours: number;
          progress_pct: number;
          expected_pct: number | null;
          recommendation: string;
          reason: string;
        }[];
      };
      admin_update_user_role: {
        Args: {
          target_user_id: string;
          new_role: Database["public"]["Enums"]["app_role"];
        };
        Returns: void;
      };
      ensure_own_student_role: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_staff: {
        Args: { _user_id: string };
        Returns: boolean;
      };
      self_grant_faculty: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
    };
    Enums: {
      app_role: "student" | "faculty" | "admin";
      project_status: "active" | "completed" | "archived";
      session_status: "active" | "pending" | "approved" | "rejected";
      submission_status: "pending" | "approved" | "rejected";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["student", "faculty", "admin"],
      project_status: ["active", "completed", "archived"],
      session_status: ["active", "pending", "approved", "rejected"],
      submission_status: ["pending", "approved", "rejected"],
    },
  },
} as const;
