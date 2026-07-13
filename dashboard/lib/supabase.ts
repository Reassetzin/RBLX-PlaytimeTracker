import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export type Session = {
  id: string
  username: string
  user_id: number
  game_name: string
  session_time: number
  total_time: number
  session_count: number
  created_at: string
}

export type LivePlayer = {
  user_id: number
  username: string
  game_name: string
  joined_at: string
}
