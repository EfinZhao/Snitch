import { useState, useEffect, useCallback } from 'react'
import { useAuth0 } from '@auth0/auth0-react'

/**
 * Resolves an Auth0 access token when the user is authenticated.
 * Returns the raw token string so it can be passed to the existing
 * api/client functions that accept `token: string`.
 */
export function useToken() {
  const { isAuthenticated, isLoading, getAccessTokenSilently } = useAuth0()
  const [token, setToken] = useState<string | null>(null)
  const [tokenLoading, setTokenLoading] = useState(false)

  useEffect(() => {
    if (!isAuthenticated || isLoading) {
      setToken(null)
      return
    }

    let cancelled = false
    setTokenLoading(true)
    getAccessTokenSilently()
      .then((t) => {
        if (!cancelled) {
          setToken(t)
          setTokenLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setToken(null)
          setTokenLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [isAuthenticated, isLoading, getAccessTokenSilently])

  const refreshToken = useCallback(async () => {
    try {
      const t = await getAccessTokenSilently({ cacheMode: 'off' })
      setToken(t)
      return t
    } catch {
      setToken(null)
      return null
    }
  }, [getAccessTokenSilently])

  return { token, tokenLoading, refreshToken }
}
