/**
 * Worker sessions run in their ticket directory without registering that directory as a sidebar workspace.
 * Same-thread follow-ups keep one ticket, one worker session id, and one execution directory.
 * A separate accepted task gets its own directory and session, still without a workspace registration.
 */
import { afterEach, expect, it } from 'vitest'
import { CHAT, feishu, startRuntime, type Host } from './fixtures/host.ts'

let h: Host | undefined
afterEach(async () => { await h?.stop(); h = undefined })

const followup = (id: string, text: string) => feishu(id, text, { mentions: [], root_id: 'om_1' })

type SessionCreate = { sessionId: string; cwd?: string; workspaceId?: string }
type Watch = { workspaceCalls: string[]; sessionCalls: SessionCreate[] }

function watch(host: Host): Watch {
  const registry = host.ctx.workspaceRegistry as { create: (cwd: string) => Promise<{ id: string }> }
  const workspaceCalls: string[] = []
  const known = new Map<string, { id: string }>()
  const original = registry.create.bind(registry)
  registry.create = async (cwd: string) => {
    workspaceCalls.push(cwd)
    const existing = known.get(cwd)
    if (existing) return existing
    const created = await original(cwd)
    known.set(cwd, created)
    return created
  }
  const sessionCalls: SessionCreate[] = []
  const implementation = host.controller.create.getMockImplementation()
  host.controller.create.mockImplementation(async (request: SessionCreate) => {
    sessionCalls.push({ sessionId: request.sessionId, ...request.cwd === undefined ? {} : { cwd: request.cwd },
      ...request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId } })
    return implementation?.(request)
  })
  return { workspaceCalls, sessionCalls }
}

it('keeps one ticket directory and one worker session across same-thread follow-ups', async () => {
  h = await startRuntime()
  const seen = watch(h)
  const { ticket, sessionId } = await h.acceptedTicket(feishu('1', '@bot 修一下回归'))
  const directory = ticket.execution?.directory
  expect(directory).toEqual(expect.stringContaining('fix-regression-'))
  expect(h.runtime.store.tickets.list()).toHaveLength(1)
  expect(seen.workspaceCalls).toEqual([])
  expect(seen.sessionCalls).toEqual([{ sessionId, cwd: directory }])
  const thread = `feishu:${CHAT}:om_1`
  expect(h.runtime.store.decisions.byThread(thread)).toHaveLength(1)

  h.runtime.receive(followup('2', '标题也改一下'))
  await h.runtime.idle()
  h.runtime.receive(followup('3', '再收紧一点'))
  await h.runtime.idle()

  const tickets = h.runtime.store.tickets.list()
  expect(tickets.map(item => item.id)).toEqual([ticket.id])
  expect(tickets[0]?.execution?.directory).toBe(directory)
  expect(seen.workspaceCalls).toEqual([])
  expect(seen.sessionCalls).toEqual([{ sessionId, cwd: directory }])
  expect(h.runtime.store.decisions.byThread(thread)).toHaveLength(1)
  expect(h.agents.has(sessionId)).toBe(true)
})

it('recreates the same worker session in the same directory when the live agent is gone', async () => {
  h = await startRuntime()
  const seen = watch(h)
  const { ticket, sessionId } = await h.acceptedTicket(feishu('1', '@bot 修一下回归'))
  const directory = ticket.execution!.directory
  h.agents.delete(sessionId)
  expect(h.agents.has(sessionId)).toBe(false)

  h.runtime.receive(followup('2', '继续改标题'))
  await h.runtime.idle()

  expect(h.runtime.store.tickets.list().map(item => item.id)).toEqual([ticket.id])
  expect(h.runtime.store.tickets.get(ticket.id)?.execution?.directory).toBe(directory)
  expect(seen.workspaceCalls).toEqual([])
  expect(seen.sessionCalls).toEqual([
    { sessionId, cwd: directory },
    { sessionId, cwd: directory },
  ])
  expect(h.agents.has(sessionId)).toBe(true)
})

it('does not register a workspace when a running ticket is resumed', async () => {
  h = await startRuntime()
  const seen = watch(h)
  const { ticket } = await h.acceptedTicket(feishu('1', '@bot 修一下回归'))
  const directory = ticket.execution?.directory
  h.runtime.executor.resume()
  await h.runtime.idle()
  expect(h.runtime.store.tickets.list().map(item => item.id)).toEqual([ticket.id])
  expect(h.runtime.store.tickets.get(ticket.id)?.execution?.directory).toBe(directory)
  expect(seen.workspaceCalls).toEqual([])
  expect(seen.sessionCalls.every(call => call.workspaceId === undefined)).toBe(true)
})

it('still opens a second directory when a separate task is accepted', async () => {
  h = await startRuntime()
  const seen = watch(h)
  const first = await h.acceptedTicket(feishu('1', '@bot 修一下回归'))
  const other = feishu('9', '@bot 另一件独立的事')
  h.runtime.receive(other)
  await h.runtime.idle()
  expect(h.runtime.store.tickets.list()).toHaveLength(1)
  expect(seen.workspaceCalls).toEqual([])
  const routed = await h.route({ kind: 'accept', trigger_id: other.id, title: '另一件事', worktree_name: 'other-task', acknowledgement: '收到。' })
  await h.runtime.idle()
  const secondId = (routed.ticket as { ticket_id: string }).ticket_id
  const second = h.runtime.store.tickets.get(secondId)!
  const directories = [first.ticket.execution?.directory, second.execution?.directory]
  expect(new Set(directories).size).toBe(2)
  expect(h.runtime.store.tickets.list()).toHaveLength(2)
  expect(seen.workspaceCalls).toEqual([])
  expect(seen.sessionCalls).toEqual([
    { sessionId: first.sessionId, cwd: directories[0] },
    { sessionId: `worker-${secondId}`, cwd: directories[1] },
  ])
})
