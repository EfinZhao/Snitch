import { useEffect, useRef, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import type { Stripe, StripeElements, StripePaymentElement } from '@stripe/stripe-js'
import Button from './atoms/Button'
import { apiPost } from '../api/client'

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string)

interface Props {
  clientSecret: string
  token: string
  onSuccess: () => void
}

export default function StripeCardForm({ clientSecret, token, onSuccess }: Props) {
  // mountRef must never have React children — Stripe owns this DOM node entirely
  const mountRef = useRef<HTMLDivElement>(null)
  const stripeRef = useRef<Stripe | null>(null)
  const elementsRef = useRef<StripeElements | null>(null)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let pe: StripePaymentElement | null = null
    let cancelled = false

    stripePromise.then(stripe => {
      if (cancelled || !stripe || !mountRef.current) return
      stripeRef.current = stripe
      const elements = stripe.elements({
        clientSecret,
        appearance: {
          theme: 'flat',
          variables: {
            colorPrimary: '#5c6bc0',
            colorBackground: 'var(--color-surface, #ffffff)',
            colorText: 'var(--color-on-surface, #1c1b1f)',
            colorDanger: 'var(--color-error, #b3261e)',
            fontFamily: 'Be Vietnam Pro, system-ui, sans-serif',
            borderRadius: '8px',
          },
        },
      })
      elementsRef.current = elements
      pe = elements.create('payment')
      pe.mount(mountRef.current)
      pe.on('ready', () => { if (!cancelled) setReady(true) })
    })

    return () => {
      cancelled = true
      pe?.unmount()
    }
  }, [clientSecret])

  async function handleSave() {
    const stripe = stripeRef.current
    const elements = elementsRef.current
    if (!stripe || !elements) return
    setError('')
    setLoading(true)

    const { setupIntent, error: stripeError } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: `${window.location.origin}/connect/return` },
      redirect: 'if_required',
    })

    if (stripeError) {
      setError(stripeError.message ?? 'Card setup failed. Please try again.')
      setLoading(false)
      return
    }

    if (!setupIntent?.id) {
      setError('Card setup did not complete. Please try again.')
      setLoading(false)
      return
    }

    // Tell the backend about the confirmed SetupIntent so it can store the
    // payment method immediately, without waiting for the webhook.
    try {
      await apiPost('/payments/confirm-setup', { setup_intent_id: setupIntent.id }, token)
    } catch {
      setError('Card saved with Stripe but we could not reach our server. Please try again.')
      setLoading(false)
      return
    }

    onSuccess()
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Spinner sits outside mountRef — Stripe's iframe owns mountRef entirely */}
      {!ready && (
        <div className="min-h-32 flex items-center justify-center">
          <svg className="animate-spin text-primary" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        </div>
      )}
      <div ref={mountRef} />
      {error && <p className="font-body text-sm text-error">{error}</p>}
      <Button variant="primary" fullWidth onClick={handleSave} disabled={!ready || loading}>
        {loading ? 'Saving card…' : 'Save Card'}
      </Button>
    </div>
  )
}
