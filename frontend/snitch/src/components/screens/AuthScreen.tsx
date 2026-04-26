import { useAuth0 } from '@auth0/auth0-react'
import Button from '../atoms/Button'

function parseDiscordUidFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('discord_uid') ?? params.get('discordId') ?? params.get('uid')
  if (!raw) return null
  if (!/^\d+$/.test(raw)) return null
  return raw
}

export default function AuthScreen() {
  const { loginWithRedirect } = useAuth0()
  const discordUid = parseDiscordUidFromUrl()

  function handleLogin() {
    loginWithRedirect({
      appState: discordUid ? { discord_uid: discordUid } : undefined,
    })
  }

  function handleSignUp() {
    loginWithRedirect({
      authorizationParams: { screen_hint: 'signup' },
      appState: discordUid ? { discord_uid: discordUid } : undefined,
    })
  }

  return (
    <div className="flex flex-col flex-1 overflow-y-auto">
      <div className="flex-1 flex flex-col items-center justify-end pb-7 px-6 gap-1">
        <h1 className="font-display font-semibold text-5xl text-primary italic tracking-tight select-none">
          Snitch
        </h1>
        <p className="font-body italic text-sm text-on-surface-variant text-center leading-snug">
          "Stay focused. Or face the consequences."
        </p>
      </div>

      <div className="flex-1 flex flex-col px-5 pt-4 pb-8 gap-4">
        <Button variant="primary" fullWidth onClick={handleLogin}>
          Sign In
        </Button>

        <Button variant="secondary" fullWidth onClick={handleSignUp}>
          Create Account
        </Button>

        {discordUid && (
          <p className="font-body text-xs text-on-surface-variant text-center leading-snug">
            Your Discord account will be linked automatically.
          </p>
        )}
      </div>
    </div>
  )
}
