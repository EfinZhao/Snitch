import { useState, type FormEvent } from 'react'
import Button from '../atoms/Button'
import { apiPost, apiPostForm, ApiError } from '../../api/client'

type Mode = 'signin' | 'signup'

interface AuthScreenProps {
  onAuthenticated: (token: string) => void
}

const INPUT_CLASS = [
  'w-full border border-outline-variant rounded-lg px-4 py-3',
  'font-body text-sm bg-surface text-on-surface',
  'placeholder:text-on-surface-variant/60',
  'focus:outline-none focus:border-primary transition-colors',
].join(' ')

const LABEL_CLASS = 'font-body text-xs font-semibold text-on-surface-variant uppercase tracking-wide'

export default function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [redirecting, setRedirecting] = useState(false)

  function switchMode(next: Mode) {
    setMode(next)
    setError('')
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (mode === 'signup') {
        await apiPost('/users', { email, password, username })
      }

      const { access_token } = await apiPostForm<{ access_token: string; token_type: string }>(
        '/auth/login',
        { username: email, password },
      )

      localStorage.setItem('snitch_token', access_token)

      if (mode === 'signup') {
        setLoading(false)
        setRedirecting(true)
        const { url } = await apiPost<{ url: string }>(
          '/connect/onboarding-link',
          {},
          access_token,
        )
        window.location.href = url
      } else {
        onAuthenticated(access_token)
      }
    } catch (err) {
      setRedirecting(false)
      if (err instanceof ApiError) {
        if (err.status === 409) setError('That email or username is already taken.')
        else if (err.status === 401) setError('Incorrect email or password.')
        else setError(err.message)
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  if (redirecting) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4 px-6">
        <svg
          className="animate-spin text-primary"
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
        <p className="font-body text-sm text-on-surface-variant italic text-center">
          Redirecting to payment setup…
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col flex-1 overflow-y-auto"
    >
      {/*
        Top section — flexible, logo pinned to its bottom edge.
        Equal flex-1 with the bottom section keeps email+password centered.
      */}
      <div className="flex-1 flex flex-col items-center justify-end pb-7 px-6 gap-1">
        <h1 className="font-display font-semibold text-5xl text-primary italic tracking-tight select-none">
          Snitch
        </h1>
        <p className="font-body italic text-sm text-on-surface-variant text-center leading-snug">
          "Stay focused. Or face the consequences."
        </p>
      </div>

      {/*
        Core section — never moves regardless of mode.
        Toggle + email + password always stay at this vertical position.
      */}
      <div className="flex-shrink-0 flex flex-col px-5 gap-4">
        {/* Mode toggle */}
        <div className="flex bg-surface-container rounded-lg p-1">
          {(['signin', 'signup'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={[
                'flex-1 py-2.5 font-display font-semibold text-sm rounded-md transition-all duration-150 select-none',
                mode === m
                  ? 'bg-surface text-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface',
              ].join(' ')}
            >
              {m === 'signin' ? 'Sign In' : 'Sign Up'}
            </button>
          ))}
        </div>

        {/* Email — always at this position, never shifts */}
        <div className="flex flex-col gap-1.5">
          <label className={LABEL_CLASS}>Email</label>
          <input
            className={INPUT_CLASS}
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        {/* Password — always at this position, never shifts */}
        <div className="flex flex-col gap-1.5">
          <label className={LABEL_CLASS}>Password</label>
          <input
            className={INPUT_CLASS}
            type="password"
            placeholder={mode === 'signup' ? 'Choose a password' : 'Your password'}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'signup' ? 8 : 1}
          />
        </div>
      </div>

      {/*
        Bottom section — flexible, matches top flex-1.
        Sign-up extras (username, note) grow this section downward
        without disturbing the core fields above.
      */}
      <div className="flex-1 flex flex-col px-5 pt-4 pb-8 gap-4 overflow-y-auto">
        {/* Username appears here, below password, only in sign-up */}
        {mode === 'signup' && (
          <div className="flex flex-col gap-1.5">
            <label className={LABEL_CLASS}>Username</label>
            <input
              className={INPUT_CLASS}
              type="text"
              placeholder="your_handle"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={2}
              maxLength={32}
            />
          </div>
        )}

        {error && (
          <p className="font-body text-sm text-error leading-snug">{error}</p>
        )}

        <Button type="submit" variant="primary" fullWidth disabled={loading}>
          {loading
            ? 'Please wait…'
            : mode === 'signin'
              ? 'Sign In'
              : 'Create Account'}
        </Button>

        {mode === 'signup' && (
          <p className="font-body text-xs text-on-surface-variant text-center leading-snug">
            After account creation you'll be taken to Stripe to set up your payment account.
          </p>
        )}
      </div>
    </form>
  )
}
