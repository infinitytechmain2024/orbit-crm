export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      lead_clients: {
        Row: {
          ai_offer_script: Json | null;
          business_name: string;
          category: string;
          city_location: string;
          contact_phone: string | null;
          country: string;
          country_flag: string;
          created_at: string;
          email: string;
          google_maps_url: string | null;
          id: string;
          priority: Database["public"]["Enums"]["lead_client_priority"];
          source_query: string | null;
          status: Database["public"]["Enums"]["lead_client_status"];
          updated_at: string;
          user_id: string;
          website_status_type: Database["public"]["Enums"]["lead_website_status"] | null;
          website_url: string;
          whatsapp_status: string;
        };
        Insert: {
          ai_offer_script?: Json | null;
          business_name: string;
          category: string;
          city_location: string;
          contact_phone?: string | null;
          country?: string;
          country_flag?: string;
          created_at?: string;
          email?: string;
          google_maps_url?: string | null;
          id?: string;
          priority?: Database["public"]["Enums"]["lead_client_priority"];
          source_query?: string | null;
          status?: Database["public"]["Enums"]["lead_client_status"];
          updated_at?: string;
          user_id: string;
          website_status_type?: Database["public"]["Enums"]["lead_website_status"] | null;
          website_url?: string;
          whatsapp_status?: string;
        };
        Update: {
          ai_offer_script?: Json | null;
          business_name?: string;
          category?: string;
          city_location?: string;
          contact_phone?: string | null;
          country?: string;
          country_flag?: string;
          created_at?: string;
          email?: string;
          google_maps_url?: string | null;
          id?: string;
          priority?: Database["public"]["Enums"]["lead_client_priority"];
          source_query?: string | null;
          status?: Database["public"]["Enums"]["lead_client_status"];
          updated_at?: string;
          user_id?: string;
          website_status_type?: Database["public"]["Enums"]["lead_website_status"] | null;
          website_url?: string;
          whatsapp_status?: string;
        };
        Relationships: [];
      };
      finance_transactions: {
        Row: {
          amount: number;
          category: string;
          created_at: string;
          created_by: string;
          id: string;
          label: string;
          occurred_on: string;
          organization_id: string;
          task_id: string | null;
          type: Database["public"]["Enums"]["finance_transaction_type"];
          updated_at: string;
        };
        Insert: {
          amount: number;
          category: string;
          created_at?: string;
          created_by: string;
          id?: string;
          label: string;
          occurred_on?: string;
          organization_id: string;
          task_id?: string | null;
          type: Database["public"]["Enums"]["finance_transaction_type"];
          updated_at?: string;
        };
        Update: {
          amount?: number;
          category?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          label?: string;
          occurred_on?: string;
          organization_id?: string;
          task_id?: string | null;
          type?: Database["public"]["Enums"]["finance_transaction_type"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "finance_transactions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finance_transactions_task_same_organization_fkey";
            columns: ["organization_id", "task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      organization_members: {
        Row: {
          created_at: string;
          created_by: string | null;
          organization_id: string;
          role: Database["public"]["Enums"]["organization_role"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          organization_id: string;
          role?: Database["public"]["Enums"]["organization_role"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          organization_id?: string;
          role?: Database["public"]["Enums"]["organization_role"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          email: string | null;
          full_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      project_links: {
        Row: {
          created_at: string;
          created_by: string;
          organization_id: string;
          source_project_id: string;
          target_project_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          organization_id: string;
          source_project_id: string;
          target_project_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          organization_id?: string;
          source_project_id?: string;
          target_project_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_links_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_links_source_project_id_fkey";
            columns: ["source_project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_links_target_project_id_fkey";
            columns: ["target_project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_members: {
        Row: {
          created_at: string;
          created_by: string;
          organization_id: string;
          project_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          organization_id: string;
          project_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          organization_id?: string;
          project_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_members_organization_id_project_id_fkey";
            columns: ["organization_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "project_members_organization_id_user_id_fkey";
            columns: ["organization_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["organization_id", "user_id"];
          },
        ];
      };
      projects: {
        Row: {
          archived_at: string | null;
          budget_planned: number | null;
          color: string;
          created_at: string;
          created_by: string;
          currency: string;
          description: string | null;
          due_date: string | null;
          id: string;
          name: string;
          organization_id: string;
          owner_id: string | null;
          priority: Database["public"]["Enums"]["project_priority"];
          start_date: string | null;
          status: Database["public"]["Enums"]["project_status"];
          updated_at: string;
          x_position: number;
          y_position: number;
        };
        Insert: {
          archived_at?: string | null;
          budget_planned?: number | null;
          color?: string;
          created_at?: string;
          created_by: string;
          currency?: string;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          name: string;
          organization_id: string;
          owner_id?: string | null;
          priority?: Database["public"]["Enums"]["project_priority"];
          start_date?: string | null;
          status?: Database["public"]["Enums"]["project_status"];
          updated_at?: string;
          x_position?: number;
          y_position?: number;
        };
        Update: {
          archived_at?: string | null;
          budget_planned?: number | null;
          color?: string;
          created_at?: string;
          created_by?: string;
          currency?: string;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          name?: string;
          organization_id?: string;
          owner_id?: string | null;
          priority?: Database["public"]["Enums"]["project_priority"];
          start_date?: string | null;
          status?: Database["public"]["Enums"]["project_status"];
          updated_at?: string;
          x_position?: number;
          y_position?: number;
        };
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      files: {
        Row: {
          bucket_id: string;
          created_at: string;
          file_name: string;
          id: string;
          mime_type: string;
          organization_id: string;
          size_bytes: number;
          storage_path: string;
          task_id: string;
          uploaded_by: string;
        };
        Insert: {
          bucket_id?: string;
          created_at?: string;
          file_name: string;
          id?: string;
          mime_type: string;
          organization_id: string;
          size_bytes: number;
          storage_path: string;
          task_id: string;
          uploaded_by: string;
        };
        Update: {
          bucket_id?: string;
          created_at?: string;
          file_name?: string;
          id?: string;
          mime_type?: string;
          organization_id?: string;
          size_bytes?: number;
          storage_path?: string;
          task_id?: string;
          uploaded_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "files_task_id_fkey";
            columns: ["organization_id", "task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      task_assignees: {
        Row: {
          created_at: string;
          created_by: string;
          organization_id: string;
          task_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          organization_id: string;
          task_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          organization_id?: string;
          task_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_assignees_organization_id_task_id_fkey";
            columns: ["organization_id", "task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "task_assignees_organization_id_user_id_fkey";
            columns: ["organization_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["organization_id", "user_id"];
          },
        ];
      };
      task_checklist_items: {
        Row: {
          completed_at: string | null;
          completed_by: string | null;
          created_at: string;
          created_by: string;
          id: string;
          organization_id: string;
          sort_order: number;
          task_id: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          created_by: string;
          id?: string;
          organization_id: string;
          sort_order?: number;
          task_id: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          created_by?: string;
          id?: string;
          organization_id?: string;
          sort_order?: number;
          task_id?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_checklist_items_organization_id_task_id_fkey";
            columns: ["organization_id", "task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      task_comments: {
        Row: {
          body: string;
          created_at: string;
          created_by: string;
          id: string;
          organization_id: string;
          task_id: string;
          updated_at: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          created_by: string;
          id?: string;
          organization_id: string;
          task_id: string;
          updated_at?: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          organization_id?: string;
          task_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_comments_organization_id_task_id_fkey";
            columns: ["organization_id", "task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      task_label_links: {
        Row: {
          created_at: string;
          created_by: string;
          label_id: string;
          organization_id: string;
          task_id: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          label_id: string;
          organization_id: string;
          task_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          label_id?: string;
          organization_id?: string;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_label_links_organization_id_label_id_fkey";
            columns: ["organization_id", "label_id"];
            isOneToOne: false;
            referencedRelation: "task_labels";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "task_label_links_organization_id_task_id_fkey";
            columns: ["organization_id", "task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      task_labels: {
        Row: {
          color: string;
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          organization_id: string;
          updated_at: string;
        };
        Insert: {
          color?: string;
          created_at?: string;
          created_by: string;
          id?: string;
          name: string;
          organization_id: string;
          updated_at?: string;
        };
        Update: {
          color?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          name?: string;
          organization_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_labels_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      task_watchers: {
        Row: {
          created_at: string;
          created_by: string;
          organization_id: string;
          task_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          organization_id: string;
          task_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          organization_id?: string;
          task_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_watchers_organization_id_task_id_fkey";
            columns: ["organization_id", "task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "task_watchers_organization_id_user_id_fkey";
            columns: ["organization_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["organization_id", "user_id"];
          },
        ];
      };
      task_view_preferences: {
        Row: {
          created_at: string;
          filters: Json;
          list_columns: string[];
          organization_id: string;
          page_size: number;
          selected_view: string;
          sort_direction: string;
          sort_key: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          filters?: Json;
          list_columns?: string[];
          organization_id: string;
          page_size?: number;
          selected_view?: string;
          sort_direction?: string;
          sort_key?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          filters?: Json;
          list_columns?: string[];
          organization_id?: string;
          page_size?: number;
          selected_view?: string;
          sort_direction?: string;
          sort_key?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_view_preferences_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          actual_minutes: number;
          archived_at: string | null;
          assignee_id: string | null;
          author_id: string;
          completed_at: string | null;
          created_at: string;
          created_by: string;
          currency: string;
          description: string | null;
          due_date: string | null;
          estimated_minutes: number | null;
          expected_revenue: number | null;
          id: string;
          internal_cost: number | null;
          note: string | null;
          organization_id: string;
          parent_task_id: string | null;
          priority: Database["public"]["Enums"]["task_priority"];
          project_id: string | null;
          sort_order: number;
          start_date: string | null;
          status: string;
          tags: string[];
          title: string;
          updated_at: string;
        };
        Insert: {
          actual_minutes?: number;
          archived_at?: string | null;
          assignee_id?: string | null;
          author_id: string;
          completed_at?: string | null;
          created_at?: string;
          created_by: string;
          currency?: string;
          description?: string | null;
          due_date?: string | null;
          estimated_minutes?: number | null;
          expected_revenue?: number | null;
          id?: string;
          internal_cost?: number | null;
          note?: string | null;
          organization_id: string;
          parent_task_id?: string | null;
          priority?: Database["public"]["Enums"]["task_priority"];
          project_id?: string | null;
          sort_order?: number;
          start_date?: string | null;
          status?: string;
          tags?: string[];
          title: string;
          updated_at?: string;
        };
        Update: {
          actual_minutes?: number;
          archived_at?: string | null;
          assignee_id?: string | null;
          author_id?: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string;
          currency?: string;
          description?: string | null;
          due_date?: string | null;
          estimated_minutes?: number | null;
          expected_revenue?: number | null;
          id?: string;
          internal_cost?: number | null;
          note?: string | null;
          organization_id?: string;
          parent_task_id?: string | null;
          priority?: Database["public"]["Enums"]["task_priority"];
          project_id?: string | null;
          sort_order?: number;
          start_date?: string | null;
          status?: string;
          tags?: string[];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_same_organization_fkey";
            columns: ["organization_id", "assignee_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["organization_id", "user_id"];
          },
          {
            foreignKeyName: "tasks_author_same_organization_fkey";
            columns: ["organization_id", "author_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["organization_id", "user_id"];
          },
          {
            foreignKeyName: "tasks_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_parent_task_same_organization_fkey";
            columns: ["organization_id", "parent_task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "tasks_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_project_same_organization_fkey";
            columns: ["organization_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      archive_task: {
        Args: {
          p_task_id: string;
        };
        Returns: Database["public"]["Tables"]["tasks"]["Row"];
      };
      create_project: {
        Args: {
          p_budget_planned: number | null;
          p_color: string | null;
          p_currency: string | null;
          p_description: string | null;
          p_due_date: string | null;
          p_member_ids: string[] | null;
          p_name: string;
          p_organization_id: string;
          p_owner_id: string | null;
          p_priority: Database["public"]["Enums"]["project_priority"] | null;
          p_start_date: string | null;
          p_status: Database["public"]["Enums"]["project_status"] | null;
        };
        Returns: Database["public"]["Tables"]["projects"]["Row"];
      };
      delete_task: {
        Args: {
          p_task_id: string;
        };
        Returns: undefined;
      };
      update_project: {
        Args: {
          p_budget_planned: number | null;
          p_color: string | null;
          p_currency: string | null;
          p_description: string | null;
          p_due_date: string | null;
          p_member_ids: string[] | null;
          p_name: string;
          p_owner_id: string | null;
          p_priority: Database["public"]["Enums"]["project_priority"] | null;
          p_project_id: string;
          p_start_date: string | null;
          p_status: Database["public"]["Enums"]["project_status"] | null;
        };
        Returns: Database["public"]["Tables"]["projects"]["Row"];
      };
    };
    Enums: {
      finance_transaction_type: "income" | "expense";
      lead_client_priority: "High" | "Middle" | "Low";
      lead_client_status: "Lead" | "New" | "In Progress" | "Rejected" | "Archived";
      lead_website_status: "no_website" | "needs_upgrade" | "good";
      organization_role: "owner" | "admin" | "manager" | "member" | "accountant";
      project_priority: "low" | "medium" | "high" | "critical";
      project_status: "planned" | "active" | "paused" | "completed" | "archived";
      task_priority: "low" | "med" | "high";
      task_status: "backlog" | "in_progress" | "review" | "completed";
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
      finance_transaction_type: ["income", "expense"],
      lead_client_priority: ["High", "Middle", "Low"],
      lead_client_status: ["Lead", "New", "In Progress", "Rejected", "Archived"],
      lead_website_status: ["no_website", "needs_upgrade", "good"],
      organization_role: ["owner", "admin", "manager", "member", "accountant"],
      project_priority: ["low", "medium", "high", "critical"],
      project_status: ["planned", "active", "paused", "completed", "archived"],
      task_priority: ["low", "med", "high"],
      task_status: ["backlog", "in_progress", "review", "completed"],
    },
  },
} as const;
