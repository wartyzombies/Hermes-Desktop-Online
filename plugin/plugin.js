/**
 * Hermes Online Desktop runtime plugin.
 *
 * This contributes a navigation card to Hermes Desktop that opens the official
 * Hermes Web Dashboard. It deliberately does not embed a guessed internal API
 * or proxy backend credentials. The dashboard itself provides the browser TUI
 * and authenticated remote-backend support documented by Hermes.
 *
 * Contract sources (official upstream):
 * - https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/contrib/plugin.ts
 * - https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/contrib/types.ts
 * - https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/web-dashboard.md
 */
import { jsx } from 'react/jsx-runtime'
import * as React from 'react'
import { host } from '@hermes/plugin-sdk'

const DEFAULT_URL = 'http://127.0.0.1:9119'
const KEY = 'dashboardUrl'

function normalizeDashboardUrl(value) {
  const parsed = new URL(value)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Dashboard address must use http:// or https://')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Do not put credentials in the dashboard URL')
  }
  return parsed.origin
}

function DashboardPanel({ ctx }) {
  const configured = ctx.storage.get(KEY, DEFAULT_URL)
  const [current, setCurrent] = React.useState(configured)
  const [error, setError] = React.useState('')

  const launch = () => {
    try {
      const destination = normalizeDashboardUrl(current)
      // `os.openExternal` is the documented, user-mediated OS door. If no
      // desktop shell is available, explain the fallback rather than guessing
      // a window API or embedding remote content with ambient credentials.
      void ctx.os.openExternal(destination).then(opened => {
        if (!opened) host.notify('Open this dashboard in your browser: ' + destination)
      }).catch(() => {
        host.notify('Could not open the dashboard. Open this address in your browser: ' + destination)
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Invalid dashboard address'
      setError(message)
      host.notify(message)
    }
  }

  return jsx('section', {
    className: 'p-4 space-y-3',
    children: [
      jsx('h2', { children: 'Hermes Web Dashboard' }),
      jsx('p', { children: 'Open Hermes in your browser. Start the official dashboard with `hermes dashboard` first.' }),
      jsx('label', {
        className: 'block space-y-1',
        children: [
          jsx('span', { children: 'Dashboard address' }),
          jsx('input', {
            type: 'url',
            defaultValue: configured,
            placeholder: DEFAULT_URL,
            'aria-label': 'Dashboard address',
            onChange: event => {
              setCurrent(event.currentTarget.value)
              setError('')
            },
            onBlur: event => {
              try {
                const normalized = normalizeDashboardUrl(event.currentTarget.value)
                setCurrent(normalized)
                ctx.storage.set(KEY, normalized)
                event.currentTarget.value = normalized
                setError('')
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'Invalid address')
              }
            }
          })
        ]
      }),
      error ? jsx('p', { role: 'alert', children: error }) : null,
      jsx('button', { type: 'button', onClick: launch, children: 'Open dashboard' }),
      jsx('p', { children: 'For a remote host, use HTTPS and configure dashboard authentication before connecting.' })
    ]
  })
}

export default {
  id: 'hermes-online-desktop',
  name: 'Hermes Online Desktop',
  description: 'Open the official Hermes web dashboard from Desktop.',
  defaultEnabled: true,
  register(ctx) {
    ctx.register({
      id: 'dashboard',
      area: 'secondarySidebar',
      title: 'Online dashboard',
      order: 900,
      render: () => jsx(DashboardPanel, { ctx })
    })
  }
}
