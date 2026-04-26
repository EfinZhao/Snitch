export type Screen = 'dashboard' | 'stats' | 'settings' | 'monitor'

export interface UserProfile {
  id: number
  email: string
  username: string
  discord_uid: number | null
  stripe_customer_id: string | null
  stripe_account_id: string | null
  stripe_account_enabled: boolean
  payment_method_network: string | null
  payment_method_last4: string | null
  created_at: string
}

export interface SessionRead {
  id: number
  creator_id: number
  creator_username: string
  amount_cents: number
  duration_seconds: number
  status: 'pending' | 'active' | 'completed' | 'failed' | 'paid_out' | 'cancelled'
  created_at: string
  activated_at: string | null
  resolved_at: string | null
  elapsed_seconds: number | null
  distraction_count: number
  recipients: Array<{
    id: number
    recipient_id: number
    recipient_username: string
    payout_cents: number | null
    payout_status: 'pending' | 'paid' | 'failed'
  }>
}
