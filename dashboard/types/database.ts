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
      upsert_company: {
        Args: {
          p_name: string
          p_email: string
          p_phone: string
          p_industry: string[]
          p_city: string
          p_state: string
        }
        Returns: undefined
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
          email_message: string | null
          group: string | null
          id: number
          industry: string[] | null
          name: string
          phone: string[] | null
          primary_email: string | null
          primary_phone: string | null
          state: string | null
          status: string | null
          text_message: string | null
          updated_at: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string | null
          email?: string[] | null
          email_message?: string | null
          group?: string | null
          id?: number
          industry?: string[] | null
          name: string
          phone?: string[] | null
          primary_email?: string | null
          primary_phone?: string | null
          state?: string | null
          status?: string | null
          text_message?: string | null
          updated_at?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string | null
          email?: string[] | null
          email_message?: string | null
          group?: string | null
          id?: number
          industry?: string[] | null
          name?: string
          phone?: string[] | null
          primary_email?: string | null
          primary_phone?: string | null
          state?: string | null
          status?: string | null
          text_message?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      contacts: {
        Row: {
          company_id: string
          created_at: string | null
          email: string | null
          id: string
          message: string | null
          name: string | null
          phone: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          email?: string | null
          id?: string
          message?: string | null
          name?: string | null
          phone?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          email?: string | null
          id?: string
          message?: string | null
          name?: string | null
          phone?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          }
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
      "vehicle-photos": {
        Row: {
          company_id: number | null
          created_at: string | null
          id: number
          name: string | null
          status: string | null
        }
        Insert: {
          company_id?: number | null
          created_at?: string | null
          id?: number
          name?: string | null
          status?: string | null
        }
        Update: {
          company_id?: number | null
          created_at?: string | null
          id?: number
          name?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_company"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "vehicle-photos"
            referencedColumns: ["id"]
          },
        ]
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