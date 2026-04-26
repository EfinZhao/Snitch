import { useState } from 'react'
import Button from '../atoms/Button'
import Card from '../atoms/Card'
import StripeCardForm from '../StripeCardForm'
import { apiGet, apiPost, apiPatch, ApiError } from '../../api/client'
import type { Screen, UserProfile } from '../../types'

interface Props {
  navigate: (screen: Screen) => void
  token: string
  user: UserProfile
  onSignOut: () => void
  onUserUpdate: (user: UserProfile) => void
}

function capitalize(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-body text-xs font-semibold text-on-surface-variant uppercase tracking-wide px-1">
      {children}
    </h2>
  )
}

export default function FocusSettings({ token, user, onSignOut, onUserUpdate }: Props) {
  // ── Username ──────────────────────────────────────────────────────────────
  const [username, setUsername] = useState(user.username)
  const [usernameError, setUsernameError] = useState('')
  const [usernameSaving, setUsernameSaving] = useState(false)
  const [usernameSaved, setUsernameSaved] = useState(false)

  const usernameChanged = username.trim().toLowerCase() !== user.username

  async function handleUsernameSave() {
    const trimmed = username.trim().toLowerCase()
    if (!trimmed || !usernameChanged) return
    setUsernameError('')
    setUsernameSaving(true)
    try {
      const updated = await apiPatch<UserProfile>('/users/me', { username: trimmed }, token)
      onUserUpdate(updated)
      setUsernameSaved(true)
      setTimeout(() => setUsernameSaved(false), 2000)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setUsernameError('That username is already taken.')
      } else {
        setUsernameError('Could not save. Try again.')
      }
    } finally {
      setUsernameSaving(false)
    }
  }

  // ── Discord ───────────────────────────────────────────────────────────────
  const [discordUid, setDiscordUid] = useState(user.discord_uid?.toString() ?? '')
  const [discordError, setDiscordError] = useState('')
  const [discordSaving, setDiscordSaving] = useState(false)
  const [discordSaved, setDiscordSaved] = useState(false)

  const discordChanged = discordUid.trim() !== (user.discord_uid?.toString() ?? '')

  async function handleDiscordSave() {
    const parsed = parseInt(discordUid.trim(), 10)
    if (!discordUid.trim() || isNaN(parsed) || parsed <= 0) {
      setDiscordError('Enter a valid Discord User ID.')
      return
    }
    if (!discordChanged) return
    setDiscordError('')
    setDiscordSaving(true)
    try {
      const updated = await apiPatch<UserProfile>('/users/me/discord-link', { discord_uid: parsed }, token)
      onUserUpdate(updated)
      setDiscordSaved(true)
      setTimeout(() => setDiscordSaved(false), 2000)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setDiscordError('That Discord account is already linked to another user.')
      } else {
        setDiscordError('Could not save. Try again.')
      }
    } finally {
      setDiscordSaving(false)
    }
  }

  // ── Card ──────────────────────────────────────────────────────────────────
  const [showCardForm, setShowCardForm] = useState(false)
  const [cardClientSecret, setCardClientSecret] = useState<string | null>(null)
  const [cardLoading, setCardLoading] = useState(false)
  const [cardError, setCardError] = useState('')

  async function handleChangeCard() {
    setCardError('')
    setCardLoading(true)
    try {
      const { client_secret } = await apiPost<{ client_secret: string; customer_id: string }>(
        '/payments/setup-intent', {}, token,
      )
      setCardClientSecret(client_secret)
      setShowCardForm(true)
    } catch {
      setCardError('Could not reach the server. Try again.')
    } finally {
      setCardLoading(false)
    }
  }

  function handleCardSuccess() {
    setShowCardForm(false)
    setCardClientSecret(null)
    apiGet<UserProfile>('/users/me', token).then(onUserUpdate).catch(() => {})
  }

  const cardLabel = user.payment_method_network && user.payment_method_last4
    ? `${capitalize(user.payment_method_network)} •••• ${user.payment_method_last4}`
    : 'No card on file'

  // ── Stripe Connect ────────────────────────────────────────────────────────
  const [stripeLoading, setStripeLoading] = useState(false)
  const [stripeError, setStripeError] = useState('')

  async function handleManageStripe() {
    setStripeError('')
    setStripeLoading(true)
    try {
      const { url } = await apiPost<{ url: string }>('/connect/login-link', {}, token)
      window.location.href = url
    } catch {
      setStripeError('Could not get Stripe link. Try again.')
    } finally {
      setStripeLoading(false)
    }
  }

  return (
    <div className="px-5 py-5 flex flex-col gap-6 lg:max-w-[66%] lg:mx-auto">
      <h1 className="font-display font-semibold text-4xl text-on-surface">Settings</h1>

      {/* ── Account ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Account</SectionLabel>
        <Card>
          <div className="flex flex-col gap-3">
            <p className="font-body text-xs text-on-surface-variant">Username</p>
            <div className="flex gap-2 items-center">
              <div className="flex items-center gap-1 flex-1 border border-outline-variant rounded-lg px-3 py-2.5 bg-surface focus-within:border-primary transition-colors">
                <span className="font-body text-sm text-on-surface-variant">@</span>
                <input
                  type="text"
                  value={username}
                  onChange={e => {
                    setUsername(e.target.value.replace(/\s/g, ''))
                    setUsernameSaved(false)
                    setUsernameError('')
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') handleUsernameSave() }}
                  className="flex-1 bg-transparent font-body text-sm text-on-surface outline-none"
                />
              </div>
              <Button
                variant="primary"
                onClick={handleUsernameSave}
                disabled={usernameSaving || !usernameChanged}
              >
                {usernameSaved ? 'Saved!' : usernameSaving ? 'Saving…' : 'Save'}
              </Button>
            </div>
            {usernameError && (
              <p className="font-body text-xs text-error">{usernameError}</p>
            )}
          </div>
        </Card>
      </div>

      {/* ── Discord ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Discord</SectionLabel>
        <Card>
          <div className="flex flex-col gap-3">
            <div>
              <p className="font-body text-xs text-on-surface-variant">Discord User ID (optional)</p>
              <p className="font-body text-xs text-on-surface-variant mt-0.5">
                Link your account to Discord for our chat integrated agent.
              </p>
            </div>
            <div className="flex gap-2 items-center">
              <input
                type="text"
                inputMode="numeric"
                value={discordUid}
                onChange={e => {
                  setDiscordUid(e.target.value.replace(/\D/g, ''))
                  setDiscordSaved(false)
                  setDiscordError('')
                }}
                onKeyDown={e => { if (e.key === 'Enter') handleDiscordSave() }}
                placeholder="e.g. 123456789012345678"
                className="flex-1 border border-outline-variant rounded-lg px-3 py-2.5 bg-surface font-body text-sm text-on-surface outline-none focus:border-primary transition-colors"
              />
              <Button
                variant="primary"
                onClick={handleDiscordSave}
                disabled={discordSaving || !discordChanged || !discordUid.trim()}
              >
                {discordSaved ? 'Saved!' : discordSaving ? 'Saving…' : 'Save'}
              </Button>
            </div>
            {discordError && (
              <p className="font-body text-xs text-error">{discordError}</p>
            )}
            {user.discord_uid && (
              <p className="font-body text-xs text-on-surface-variant">
                Linked: <span className="font-semibold text-on-surface">{user.discord_uid}</span>
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* ── Payment method ───────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Payment Method</SectionLabel>
        <Card>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-body text-xs text-on-surface-variant">Card on file</p>
                <p className="font-display font-semibold text-sm text-on-surface mt-0.5">{cardLabel}</p>
              </div>
              {!showCardForm && (
                <Button variant="ghost" onClick={handleChangeCard} disabled={cardLoading}>
                  {cardLoading ? 'Loading…' : 'Change'}
                </Button>
              )}
            </div>

            {cardError && <p className="font-body text-xs text-error">{cardError}</p>}

            {showCardForm && cardClientSecret && (
              <div className="border-t border-outline-variant pt-4 flex flex-col gap-3">
                <StripeCardForm
                  clientSecret={cardClientSecret}
                  token={token}
                  onSuccess={handleCardSuccess}
                />
                <button
                  onClick={() => { setShowCardForm(false); setCardClientSecret(null) }}
                  className="font-body text-xs text-on-surface-variant hover:text-on-surface transition-colors text-left"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* ── Stripe payouts ───────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Stripe Payouts</SectionLabel>
        <Card>
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="font-body text-sm font-semibold text-on-surface">Manage Stripe Account</p>
              <p className="font-body text-xs text-on-surface-variant mt-0.5">
                Update bank info, payout settings, and identity verification.
              </p>
            </div>
            <Button variant="ghost" onClick={handleManageStripe} disabled={stripeLoading} className="flex-shrink-0">
              {stripeLoading ? 'Loading…' : 'Open'}
            </Button>
          </div>
          {stripeError && <p className="font-body text-xs text-error mt-2">{stripeError}</p>}
        </Card>
      </div>

      {/* ── Sign out ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Session</SectionLabel>
        <Button variant="danger" fullWidth onClick={onSignOut}>
          Sign Out
        </Button>
      </div>
    </div>
  )
}
