import { useState } from 'react'
import Button from '../atoms/Button'
import SectionDivider from '../atoms/SectionDivider'
import type { Screen } from '../../types'

type Recipient = { username: string; }

export default function SetTheStakes({ navigate }: { navigate: (screen: Screen) => void }) {
  const [amount, setAmount] = useState('')
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [showModal, setShowModal] = useState(false)
  const [inputVal, setInputVal] = useState('')

  function openModal() {
    setInputVal('')
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setInputVal('')
  }

  function addRecipient() {
    const username = inputVal.trim().replace(/^@/, '')
    if (!username) return
    if (recipients.some(r => r.username.toLowerCase() === username.toLowerCase())) {
      closeModal()
      return
    }
    setRecipients(prev => [...prev, { username }])
    closeModal()
  }

  function toggleRecipient(username: string) {
    setRecipients(prev =>
      prev.filter(r => r.username !== username)
    )
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') addRecipient()
    if (e.key === 'Escape') closeModal()
  }

  return (
    <div className="flex flex-col min-h-full px-6 py-10 justify-between gap-12">
      <div className="flex flex-col items-center gap-10">
        {/* Title */}
        <div className="text-center">
          <h1 className="font-display font-semibold text-5xl text-on-surface leading-tight">
            Set the Stakes
          </h1>
          <p className="font-body text-on-surface-variant mt-2 text-base">
            How much does failure cost?
          </p>
        </div>

        {/* Dollar input */}
        <div className="w-full flex items-end justify-center gap-2 border-b-2 border-on-surface pb-2">
          <span className="font-display text-2xl text-on-surface-variant mb-1">$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className="bg-transparent font-display font-semibold text-5xl text-on-surface w-48 text-center outline-none placeholder:text-outline-variant tabular-nums"
          />
        </div>

        {/* Recipients */}
        <div className="w-full">
          <SectionDivider label="Designated Recipients" />
          <div className="flex flex-wrap items-start justify-center gap-8 mt-4">
            {recipients.map(({ username }) => (
              <button key={username} onClick={() => toggleRecipient(username)} className="flex flex-col items-center gap-2">
                <div
                  className={
                    'w-20 h-20 rounded-full border-2 flex items-center justify-center text-xl font-display font-semibold transition-all border-primary bg-primary-fixed shadow-sm text-primary'
                  }
                >
                  {username.slice(0, 2).toUpperCase()}
                </div>
                <span className="font-body font-semibold text-sm text-on-surface">@{username}</span>
              </button>
            ))}

            <button className="flex flex-col items-center gap-2" onClick={openModal}>
              <div className="w-20 h-20 rounded-full border-2 border-dashed border-outline-variant flex items-center justify-center text-3xl text-on-surface-variant hover:border-primary hover:text-primary transition-colors">
                +
              </div>
              <span className="font-body text-sm text-on-surface-variant">Add New</span>
            </button>
          </div>
        </div>
      </div>

      {/* Bottom CTA */}
      <div className="flex flex-col items-center gap-5">
        <Button variant="primary" fullWidth onClick={() => navigate('dashboard')}>
          Commit Stake
        </Button>
        <p className="font-body italic text-sm text-on-surface-variant text-center">
          "Choose wisely. They'll enjoy your money more than you will."
        </p>
      </div>

      {/* Add recipient modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40" />

          {/* Sheet */}
          <div className="relative max-w-sm bg-surface rounded-2xl px-6 pt-6 pb-10 sm:pb-6 flex flex-col gap-5 shadow-xl">
            <h2 className="font-display font-semibold text-xl text-on-surface">Add Recipient</h2>

            <div className="flex items-center gap-2 border-b-2 border-primary pb-2">
              <span className="font-body text-on-surface-variant">@</span>
              <input
                ref={el => { el?.focus() }}
                type="text"
                placeholder="username"
                value={inputVal}
                onChange={e => setInputVal(e.target.value.replace(/\s/g, ''))}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-transparent font-body text-lg text-on-surface outline-none placeholder:text-outline-variant"
              />
            </div>

            <div className="flex gap-3">
              <Button variant="ghost" fullWidth onClick={closeModal}>Cancel</Button>
              <Button variant="primary" fullWidth onClick={addRecipient}>Add</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
