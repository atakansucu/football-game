import type {
  MatchRow,
  RoomPlayerRow,
  RoomRow,
  RoundRow,
} from "./game";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

/**
 * Hand-written database types. Only the columns the application reads/writes are
 * modeled. RPCs are the authoritative write path, so most Insert/Update shapes
 * are intentionally permissive.
 */
export interface Database {
  public: {
    Tables: {
      rooms: Table<RoomRow>;
      room_players: Table<RoomPlayerRow>;
      matches: Table<MatchRow>;
      rounds: Table<RoundRow>;
      submissions: Table<{
        id: string;
        round_id: string;
        user_id: string;
        raw_answer: string;
        normalized_answer: string;
        player_id: string | null;
        is_valid: boolean;
        server_received_at: string;
        created_at: string;
      }>;
      players: Table<{ id: string; name: string; normalized_name: string }>;
      clubs: Table<{ id: string; name: string; normalized_name: string }>;
      national_teams: Table<{
        id: string;
        name: string;
        normalized_name: string;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      create_room: {
        Args: {
          p_user_id: string;
          p_display_name: string;
          p_game_mode: string;
          p_win_target: number;
        };
        Returns: Json;
      };
      join_room: {
        Args: {
          p_user_id: string;
          p_display_name: string;
          p_code: string;
        };
        Returns: Json;
      };
      set_room_settings: {
        Args: {
          p_user_id: string;
          p_room_id: string;
          p_game_mode: string;
          p_win_target: number;
        };
        Returns: Json;
      };
      start_match: {
        Args: { p_user_id: string; p_room_id: string };
        Returns: Json;
      };
      start_round: {
        Args: { p_user_id: string; p_room_id: string };
        Returns: Json;
      };
      activate_due_rounds: {
        Args: Record<string, never>;
        Returns: Json;
      };
      submit_answer: {
        Args: {
          p_user_id: string;
          p_round_id: string;
          p_raw_answer: string;
        };
        Returns: Json;
      };
      play_again: {
        Args: { p_user_id: string; p_room_id: string };
        Returns: Json;
      };
      heartbeat: {
        Args: { p_user_id: string; p_room_id: string };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
