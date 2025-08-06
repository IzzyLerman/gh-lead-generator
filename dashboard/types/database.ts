export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  pgmq_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      archive: {
        Args: { queue_name: string; message_id: number }
        Returns: boolean
      }
      delete: {
        Args: { queue_name: string; message_id: number }
        Returns: boolean
      }
      pop: {
        Args: { queue_name: string }
        Returns: unknown[]
      }
      read: {
        Args: { queue_name: string; sleep_seconds: number; n: number }
        Returns: unknown[]
      }
      send: {
        Args: { queue_name: string; message: Json; sleep_seconds?: number }
        Returns: number[]
      }
      send_batch: {
        Args: { queue_name: string; messages: Json[]; sleep_seconds?: number }
        Returns: number[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  private: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      clear_test_force_company: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      export_companies_csv: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      export_contacts_csv: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      get_test_force_company: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      normalize_company_name: {
        Args: { name_input: string }
        Returns: string
      }
      normalize_email: {
        Args: { email_input: string }
        Returns: string
      }
      normalize_phone: {
        Args: { phone_input: string }
        Returns: string
      }
      normalize_website: {
        Args: { website_input: string }
        Returns: string
      }
      set_test_force_company: {
        Args: { company_index: number }
        Returns: undefined
      }
      upsert_company: {
        Args: {
          p_name: string
          p_email: string
          p_phone: string
          p_industry: string[]
          p_city: string
          p_state: string
          p_website: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      companies: {
        Row: {
          city: string | null
          created_at: string | null
          email: string[] | null
          group: string | null
          id: string
          industry: string[] | null
          name: string
          phone: string[] | null
          revenue: number | null
          state: string | null
          status: string | null
          updated_at: string | null
          website: string | null
          zoominfo_id: number | null
        }
        Insert: {
          city?: string | null
          created_at?: string | null
          email?: string[] | null
          group?: string | null
          id?: string
          industry?: string[] | null
          name: string
          phone?: string[] | null
          revenue?: number | null
          state?: string | null
          status?: string | null
          updated_at?: string | null
          website?: string | null
          zoominfo_id?: number | null
        }
        Update: {
          city?: string | null
          created_at?: string | null
          email?: string[] | null
          group?: string | null
          id?: string
          industry?: string[] | null
          name?: string
          phone?: string[] | null
          revenue?: number | null
          state?: string | null
          status?: string | null
          updated_at?: string | null
          website?: string | null
          zoominfo_id?: number | null
        }
        Relationships: []
      }
      contacts: {
        Row: {
          company_id: string
          created_at: string | null
          email: string | null
          email_body: string | null
          email_subject: string | null
          first_name: string | null
          id: string
          last_name: string | null
          middle_name: string | null
          name: string | null
          phone: string | null
          status: string | null
          text_message: string | null
          title: string | null
          updated_at: string | null
          zoominfo_id: number | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          email?: string | null
          email_body?: string | null
          email_subject?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          middle_name?: string | null
          name?: string | null
          phone?: string | null
          status?: string | null
          text_message?: string | null
          title?: string | null
          updated_at?: string | null
          zoominfo_id?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          email?: string | null
          email_body?: string | null
          email_subject?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          middle_name?: string | null
          name?: string | null
          phone?: string | null
          status?: string | null
          text_message?: string | null
          title?: string | null
          updated_at?: string | null
          zoominfo_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      debug_logs: {
        Row: {
          created_at: string | null
          id: number
          message: string | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          message?: string | null
        }
        Update: {
          created_at?: string | null
          id?: number
          message?: string | null
        }
        Relationships: []
      }
      queue_config: {
        Row: {
          created_at: string | null
          queue_name: string
          threshold: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          queue_name: string
          threshold?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          queue_name?: string
          threshold?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      test_state: {
        Row: {
          created_at: string | null
          force_company_index: number | null
          id: number
        }
        Insert: {
          created_at?: string | null
          force_company_index?: number | null
          id?: number
        }
        Update: {
          created_at?: string | null
          force_company_index?: number | null
          id?: number
        }
        Relationships: []
      }
      "vehicle-photos": {
        Row: {
          company_id: string | null
          created_at: string | null
          gps: string | null
          id: number
          location: string | null
          name: string | null
          status: string | null
          submitted_by: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          gps?: string | null
          id?: number
          location?: string | null
          name?: string | null
          status?: string | null
          submitted_by?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          gps?: string | null
          id?: number
          location?: string | null
          name?: string | null
          status?: string | null
          submitted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_company"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      zoominfo_auth: {
        Row: {
          created_at: string | null
          expires_at: string
          id: number
          jwt_token: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: number
          jwt_token: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: number
          jwt_token?: string
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  pgmq_public: {
    Enums: {},
  },
  private: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

