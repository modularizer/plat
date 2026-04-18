import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { CheckCircle2, XCircle, Clock, ShieldCheck, LogOut, Activity, ListChecks } from 'lucide-react'
import { api, type AssignedNamespace, type NamespaceRequest, type ActivityServer, type ActivityServerSnapshot, exchangeGoogleIdToken } from './lib/api'

type Tab = 'activity' | 'requests'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
            auto_select?: boolean
            cancel_on_tap_outside?: boolean
          }) => void
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void
          prompt: () => void
          disableAutoSelect: () => void
        }
      }
    }
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

export default function AdminDashboard() {
  const [tab, setTab] = useState<Tab>('activity')
  const [adminGoogleSub, setAdminGoogleSub] = useState(() => localStorage.getItem('admin_sub') || '')
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem('admin_token') || '')
  const [authError, setAuthError] = useState<string | null>(null)
  const [exchanging, setExchanging] = useState(false)
  const gsiButtonRef = useRef<HTMLDivElement | null>(null)

  const handleCredential = useCallback(async (credential: string) => {
    setAuthError(null)
    setExchanging(true)
    try {
      const result = await exchangeGoogleIdToken(credential, 'admin')
      localStorage.setItem('admin_token', result.session_token)
      localStorage.setItem('admin_sub', result.google_sub)
      setAdminToken(result.session_token)
      setAdminGoogleSub(result.google_sub)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sign-in failed'
      setAuthError(message)
    } finally {
      setExchanging(false)
    }
  }, [])

  useEffect(() => {
    if (adminToken || !GOOGLE_CLIENT_ID) return
    let cancelled = false
    const init = () => {
      if (cancelled || !window.google?.accounts?.id || !gsiButtonRef.current) return
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => { handleCredential(response.credential) },
        auto_select: false,
        cancel_on_tap_outside: true,
      })
      window.google.accounts.id.renderButton(gsiButtonRef.current, {
        type: 'standard',
        theme: 'filled_blue',
        size: 'large',
        text: 'signin_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: 320,
      })
    }
    if (window.google?.accounts?.id) {
      init()
    } else {
      const poll = window.setInterval(() => {
        if (window.google?.accounts?.id) {
          window.clearInterval(poll)
          init()
        }
      }, 100)
      return () => { cancelled = true; window.clearInterval(poll) }
    }
    return () => { cancelled = true }
  }, [adminToken, handleCredential])

  function logout(): void {
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_sub')
    setAdminToken('')
    setAdminGoogleSub('')
    window.google?.accounts?.id?.disableAutoSelect()
  }

  if (!adminToken) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-100 p-3 text-blue-700">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">PLAT Authority Admin</h1>
              <p className="text-sm text-gray-600">Sign in with Google through authority.</p>
            </div>
          </div>
          {authError ? (
            <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{authError}</div>
          ) : null}
          {!GOOGLE_CLIENT_ID ? (
            <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Set <code>VITE_GOOGLE_CLIENT_ID</code> to enable sign-in.
            </div>
          ) : (
            <div className="mt-6 flex justify-center">
              <div ref={gsiButtonRef} aria-busy={exchanging} />
            </div>
          )}
          {exchanging ? <div className="mt-3 text-center text-xs text-gray-500">Signing in…</div> : null}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <h1 className="text-xl font-bold text-gray-900">PLAT Authority Admin</h1>
            <nav className="flex gap-1">
              <TabButton active={tab === 'activity'} onClick={() => setTab('activity')} icon={<Activity className="h-4 w-4" />} label="Activity" />
              <TabButton active={tab === 'requests'} onClick={() => setTab('requests')} icon={<ListChecks className="h-4 w-4" />} label="Namespace Requests" />
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Signed In</div>
              <div className="font-mono text-xs text-gray-700">{adminGoogleSub}</div>
            </div>
            <button onClick={logout} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50">
              <LogOut className="h-4 w-4" /> Log Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 py-6">
        {tab === 'activity' ? <ActivityView onAuthError={() => { logout(); setAuthError('Session expired. Sign in again.') }} /> : <RequestsView />}
      </main>
    </div>
  )
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition ${active ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>
      {icon}{label}
    </button>
  )
}

function ActivityView({ onAuthError }: { onAuthError: () => void }) {
  const [selectedNs, setSelectedNs] = useState<string | null>(null)
  const [selectedServer, setSelectedServer] = useState<string | null>(null)
  const [selectedEventIdx, setSelectedEventIdx] = useState<number | null>(null)

  const { data: namespaces } = useQuery({
    queryKey: ['assigned-namespaces'],
    queryFn: () => api.assignedNamespaces({}),
    refetchInterval: 5000,
  })

  const { data: servers, error: serversErr } = useQuery({
    queryKey: ['activity-servers'],
    queryFn: () => api.activityServers(),
    refetchInterval: 3000,
  })

  useEffect(() => {
    const e = serversErr
    if (e instanceof Error && (e.message.includes('(401)') || e.message.includes('(403)'))) onAuthError()
  }, [serversErr])

  const { data: snapshot } = useQuery({
    queryKey: ['activity-server', selectedServer],
    queryFn: () => api.activityServer(selectedServer!),
    enabled: !!selectedServer,
    refetchInterval: 3000,
  })

  const serverList: ActivityServer[] = servers || []
  const nsKeys = useMemo(() => {
    const keys = new Map<string, { origin: string; namespace: string; ownerName: string; ownerGoogleSub: string; online: number; total: number }>()
    for (const ns of namespaces || []) {
      const k = `${ns.origin}::${ns.namespace}`
      keys.set(k, { origin: ns.origin, namespace: ns.namespace, ownerName: ns.ownerName, ownerGoogleSub: ns.ownerGoogleSub, online: 0, total: 0 })
    }
    for (const s of serverList) {
      const k = `${s.origin}::${s.namespace}`
      let entry = keys.get(k)
      if (!entry) {
        entry = { origin: s.origin, namespace: s.namespace, ownerName: s.ownerName || '(unknown)', ownerGoogleSub: s.ownerGoogleSub, online: 0, total: 0 }
        keys.set(k, entry)
      }
      entry.total += 1
      if (s.online) entry.online += 1
    }
    return Array.from(keys.entries()).map(([k, v]) => ({ key: k, ...v })).sort((a, b) => a.namespace.localeCompare(b.namespace))
  }, [namespaces, serverList])

  const filteredServers = useMemo(() => {
    if (!selectedNs) return serverList
    return serverList.filter((s) => `${s.origin}::${s.namespace}` === selectedNs)
  }, [selectedNs, serverList])

  const selectedEvent = useMemo(() => {
    if (!snapshot || selectedEventIdx == null) return null
    return snapshot.events[selectedEventIdx] ?? null
  }, [snapshot, selectedEventIdx])

  return (
    <div className="grid grid-cols-12 gap-3 h-[calc(100vh-120px)]">
      <Column title={`Namespaces (${nsKeys.length})`} className="col-span-3">
        {nsKeys.length === 0 ? <Empty label="No namespaces" /> : nsKeys.map((ns) => (
          <ColumnItem
            key={ns.key}
            selected={selectedNs === ns.key}
            onClick={() => { setSelectedNs(ns.key); setSelectedServer(null); setSelectedEventIdx(null) }}
          >
            <div className="font-mono text-sm font-semibold text-gray-900">{ns.namespace}</div>
            <div className="text-xs text-gray-500 mt-0.5">{ns.origin || '(default)'}</div>
            <div className="text-xs text-gray-600 mt-1">{ns.ownerName}</div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              <span className="text-green-600 font-semibold">{ns.online} online</span> · {ns.total} total
            </div>
          </ColumnItem>
        ))}
      </Column>

      <Column title={`Servers (${filteredServers.length})`} className="col-span-3">
        {filteredServers.length === 0 ? <Empty label={selectedNs ? 'No servers under this namespace' : 'Select a namespace'} /> : filteredServers.map((s) => (
          <ColumnItem
            key={s.serverName}
            selected={selectedServer === s.serverName}
            onClick={() => { setSelectedServer(s.serverName); setSelectedEventIdx(null) }}
          >
            <div className="flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${s.online ? 'bg-green-500' : 'bg-gray-300'}`} />
              <span className="font-mono text-sm font-semibold text-gray-900 truncate">{s.serverName}</span>
            </div>
            <div className="text-[11px] text-gray-500 mt-1">
              {s.lastSeenAt ? `last seen ${timeAgo(s.lastSeenAt)}` : 'no history'}
            </div>
            {s.ownerName ? <div className="text-[11px] text-gray-500">owner: {s.ownerName}</div> : null}
          </ColumnItem>
        ))}
      </Column>

      <Column title={`Events${snapshot ? ` (${snapshot.events.length})` : ''}`} className="col-span-3">
        {!selectedServer ? <Empty label="Select a server" /> : !snapshot ? <Empty label="Loading…" /> : (
          <>
            <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 text-xs text-gray-700">
              <div>Status: <span className={snapshot.online ? 'text-green-600 font-semibold' : 'text-gray-500'}>{snapshot.online ? 'online' : 'offline'}</span></div>
              {snapshot.authMode ? <div>Auth mode: <code>{snapshot.authMode}</code></div> : null}
              {snapshot.hostSessionId ? <div>Host session: <code className="text-[10px]">{snapshot.hostSessionId}</code></div> : null}
              {snapshot.host ? (
                <div className="mt-1 space-y-0.5">
                  <div>Host sub: <code className="text-[10px]">{snapshot.host.googleSub}</code></div>
                  <div>IP: <code className="text-[10px]">{snapshot.host.ip}</code></div>
                  <div>Connected: {new Date(snapshot.host.connectedAt).toLocaleString()}</div>
                  <div>Last pong: {timeAgo(snapshot.host.lastPongAt)}</div>
                </div>
              ) : null}
            </div>
            {snapshot.events.length === 0 ? <Empty label="No events recorded" /> : snapshot.events.map((e, i) => (
              <ColumnItem key={i} selected={selectedEventIdx === i} onClick={() => setSelectedEventIdx(i)}>
                <div className="flex items-center gap-2">
                  <EventBadge type={e.type} />
                  <span className="text-[11px] text-gray-500">{timeAgo(e.ts)}</span>
                </div>
                {e.clientKey ? <div className="text-[11px] text-gray-600 mt-1 font-mono truncate">{e.clientKey}</div> : null}
                {e.reason ? <div className="text-[11px] text-gray-500 truncate">{e.reason}</div> : null}
              </ColumnItem>
            ))}
          </>
        )}
      </Column>

      <Column title="Detail" className="col-span-3">
        {!selectedEvent ? <Empty label="Select an event" /> : (
          <div className="p-4 space-y-3 text-sm">
            <Field label="Type"><code>{selectedEvent.type}</code></Field>
            <Field label="When">{new Date(selectedEvent.ts).toLocaleString()}</Field>
            <Field label="Server"><code>{selectedEvent.serverName}</code></Field>
            {selectedEvent.hostSessionId ? <Field label="Host session"><code className="text-xs">{selectedEvent.hostSessionId}</code></Field> : null}
            {selectedEvent.authMode ? <Field label="Auth mode"><code>{selectedEvent.authMode}</code></Field> : null}
            {selectedEvent.clientKey ? <Field label="Client"><code className="text-xs break-all">{selectedEvent.clientKey}</code></Field> : null}
            {selectedEvent.reason ? <Field label="Reason"><span className="text-gray-700">{selectedEvent.reason}</span></Field> : null}
          </div>
        )}
      </Column>
    </div>
  )
}

function Column({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`bg-white rounded-lg border border-gray-200 flex flex-col overflow-hidden ${className || ''}`}>
      <div className="px-3 py-2 border-b border-gray-200 bg-gray-50">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">{title}</h3>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-gray-100">{children}</div>
    </div>
  )
}

function ColumnItem({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`w-full text-left px-3 py-2 hover:bg-gray-50 transition ${selected ? 'bg-blue-50 border-l-2 border-blue-500' : ''}`}>
      {children}
    </button>
  )
}

function Empty({ label }: { label: string }) {
  return <div className="px-3 py-6 text-center text-xs text-gray-400">{label}</div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  )
}

function EventBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    online: 'bg-green-100 text-green-800',
    offline: 'bg-gray-100 text-gray-700',
    client_connect_ok: 'bg-blue-100 text-blue-800',
    client_connect_rejected: 'bg-red-100 text-red-800',
    client_connect_timeout: 'bg-yellow-100 text-yellow-800',
    client_connect_error: 'bg-red-100 text-red-800',
  }
  const cls = colors[type] || 'bg-gray-100 text-gray-700'
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls}`}>{type}</span>
}

function timeAgo(ts: number): string {
  if (!ts) return 'never'
  const ms = Date.now() - ts
  if (ms < 60_000) return `${Math.max(0, Math.floor(ms / 1000))}s ago`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

function RequestsView() {
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null)
  const { data: requests, isLoading, refetch } = useQuery({
    queryKey: ['namespace-requests'],
    queryFn: () => api.requests({}),
  })
  const { data: assignedNamespaces } = useQuery({
    queryKey: ['assigned-namespaces'],
    queryFn: () => api.assignedNamespaces({}),
  })

  const approveMutation = useMutation({
    mutationFn: (requestId: string) => api.approve({ requestId }),
    onSuccess: () => { refetch(); setSelectedRequest(null) },
  })
  const rejectMutation = useMutation({
    mutationFn: (requestId: string) => api.reject({ requestId, reason: 'rejected' }),
    onSuccess: () => { refetch(); setSelectedRequest(null) },
  })

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Clock className="animate-spin w-8 h-8 text-blue-500" /></div>
  }

  const requestList: NamespaceRequest[] = requests || []
  const assignedList: AssignedNamespace[] = assignedNamespaces || []
  const details = requestList.find((r) => r.id === selectedRequest)

  return (
    <>
      <div className="grid grid-cols-4 gap-4 mb-6">
        <Stat label="Pending" count={requestList.filter((r) => r.status === 'pending').length} color="text-yellow-600" />
        <Stat label="Approved" count={requestList.filter((r) => r.status === 'approved').length} color="text-green-600" />
        <Stat label="Rejected" count={requestList.filter((r) => r.status === 'rejected').length} color="text-red-600" />
        <Stat label="Assigned" count={assignedList.length} color="text-blue-600" />
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200"><h2 className="text-lg font-semibold text-gray-900">Namespace Requests</h2></div>
          <div className="divide-y divide-gray-200">
            {requestList.length === 0 ? <div className="px-6 py-8 text-center text-gray-500">No requests</div> : requestList.map((request) => (
              <button key={request.id} onClick={() => setSelectedRequest(request.id)} className={`w-full text-left px-6 py-4 hover:bg-gray-50 transition ${selectedRequest === request.id ? 'bg-blue-50' : ''}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-mono text-sm font-semibold text-gray-900">{request.requestedOrigin}/{request.requestedNamespace}</div>
                    <div className="text-xs text-gray-600 mt-1">Requested by {request.requesterName}</div>
                  </div>
                  <StatusBadge status={request.status} />
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="col-span-1">
          {details ? (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200"><h3 className="font-semibold text-gray-900">Details</h3></div>
              <div className="px-6 py-4 space-y-4 text-sm">
                <Field label="Origin"><code className="block p-2 bg-gray-100 rounded break-all">{details.requestedOrigin}</code></Field>
                <Field label="Namespace"><code className="block p-2 bg-gray-100 rounded break-all">{details.requestedNamespace}</code></Field>
                <Field label="Requester"><div>{details.requesterName}</div></Field>
                <Field label="Status"><StatusBadge status={details.status} /></Field>
                {details.status === 'pending' && (
                  <div className="pt-2 space-y-2">
                    <button onClick={() => approveMutation.mutate(details.id)} disabled={approveMutation.isPending} className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded text-sm disabled:opacity-50">{approveMutation.isPending ? 'Approving…' : 'Approve'}</button>
                    <button onClick={() => rejectMutation.mutate(details.id)} disabled={rejectMutation.isPending} className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2 rounded text-sm">{rejectMutation.isPending ? 'Rejecting…' : 'Reject'}</button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-500">Select a request</div>
          )}
        </div>
      </div>

      <div className="mt-6 bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Assigned Namespaces</h2>
        </div>
        {assignedList.length === 0 ? <div className="px-6 py-8 text-center text-gray-500">No assigned namespaces</div> : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50"><tr>
                <Th>Origin</Th><Th>Namespace</Th><Th>Owner</Th><Th>Google Sub</Th><Th>Assigned</Th>
              </tr></thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {assignedList.map((e) => (
                  <tr key={`${e.origin}::${e.namespace}`}>
                    <Td><code className="rounded bg-gray-100 px-2 py-1">{e.origin || '(default)'}</code></Td>
                    <Td><code className="rounded bg-gray-100 px-2 py-1 font-semibold">{e.namespace}</code></Td>
                    <Td>{e.ownerName}</Td>
                    <Td><span className="font-mono text-xs break-all">{e.ownerGoogleSub}</span></Td>
                    <Td>{new Date(e.assignedAt).toLocaleString()}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

function Stat({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="text-sm text-gray-600">{label}</div>
      <div className={`text-3xl font-bold mt-2 ${color}`}>{count}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'pending') return <span className="flex items-center gap-1 text-sm text-yellow-600"><Clock className="w-4 h-4" />Pending</span>
  if (status === 'approved') return <span className="flex items-center gap-1 text-sm text-green-600"><CheckCircle2 className="w-4 h-4" />Approved</span>
  return <span className="flex items-center gap-1 text-sm text-red-600"><XCircle className="w-4 h-4" />Rejected</span>
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">{children}</th>
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-6 py-4 text-sm text-gray-700">{children}</td>
}
