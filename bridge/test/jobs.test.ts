import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JobStore, toPublicJob } from '../src/jobs'

const dirs: string[] = []
const workDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'fetcher-bridge-test-'))
  dirs.push(dir)
  return dir
}

after(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('JobStore', () => {
  it('persists jobs to disk and wipes tokens of terminal jobs', () => {
    const jobsPath = join(workDir(), 'jobs.json')
    const store = new JobStore(jobsPath)

    const active = store.create({
      userId: 'user-1',
      token: 'token-active',
      url: 'https://example.com/a.zip',
      fileName: 'a.zip',
      target: { spaceId: 'space-1', path: '/' }
    })
    const done = store.create({
      userId: 'user-1',
      token: 'token-done',
      url: 'https://example.com/b.zip',
      fileName: 'b.zip',
      target: { spaceId: 'space-1', path: '/' }
    })
    store.update(done.id, { state: 'complete' })

    const persisted = JSON.parse(readFileSync(jobsPath, 'utf8')) as Array<{
      id: string
      token?: string
    }>
    assert.equal(persisted.find((job) => job.id === active.id)?.token, 'token-active')
    assert.equal(persisted.find((job) => job.id === done.id)?.token, undefined)
  })

  it('reloads jobs from disk (bridge restart)', () => {
    const jobsPath = join(workDir(), 'jobs.json')
    const store = new JobStore(jobsPath)
    const job = store.create({
      userId: 'user-1',
      token: 'token-1',
      url: 'magnet:?xt=urn:btih:abc',
      fileName: null,
      target: { spaceId: 'space-1', path: '/Videos' }
    })
    store.update(job.id, { gid: 'deadbeef', state: 'downloading' })

    const reopened = new JobStore(jobsPath)
    const reloaded = reopened.get(job.id)
    assert.ok(reloaded)
    assert.equal(reloaded.userId, 'user-1')
    assert.equal(reloaded.token, 'token-1')
    assert.equal(reloaded.gid, 'deadbeef')
    assert.equal(reloaded.state, 'downloading')
  })

  it('filters jobs by user', () => {
    const store = new JobStore(join(workDir(), 'jobs.json'))
    store.create({
      userId: 'user-1',
      token: 't',
      url: 'https://example.com/1',
      fileName: null,
      target: { spaceId: 's', path: '/' }
    })
    store.create({
      userId: 'user-2',
      token: 't',
      url: 'https://example.com/2',
      fileName: null,
      target: { spaceId: 's', path: '/' }
    })

    assert.equal(store.byUser('user-1').length, 1)
    assert.equal(store.byUser('user-1')[0].userId, 'user-1')
    assert.equal(store.byUser('nobody').length, 0)
  })

  it('prunes old terminal jobs but keeps active ones', () => {
    const store = new JobStore(join(workDir(), 'jobs.json'))
    const active = store.create({
      userId: 'u',
      token: 't',
      url: 'https://example.com/1',
      fileName: null,
      target: { spaceId: 's', path: '/' }
    })
    const old = store.create({
      userId: 'u',
      token: 't',
      url: 'https://example.com/2',
      fileName: null,
      target: { spaceId: 's', path: '/' }
    })
    store.update(old.id, { state: 'complete', updatedAt: Date.now() - 48 * 60 * 60 * 1000 })

    store.prune(24 * 60 * 60 * 1000)

    assert.ok(store.get(active.id))
    assert.equal(store.get(old.id), undefined)
  })

  it('never leaks tokens or user ids in the public representation', () => {
    const store = new JobStore(join(workDir(), 'jobs.json'))
    const job = store.create({
      userId: 'user-secret',
      token: 'token-secret',
      url: 'https://example.com/x',
      fileName: 'x',
      target: { spaceId: 's', path: '/' }
    })

    const publicJob = JSON.stringify(toPublicJob(job))
    assert.ok(!publicJob.includes('token-secret'))
    assert.ok(!publicJob.includes('user-secret'))
    assert.ok(!publicJob.includes('"gid"'))
  })

  it('starts empty when jobs.json is corrupt', () => {
    const jobsPath = join(workDir(), 'jobs.json')
    writeFileSync(jobsPath, 'this is not json')
    const store = new JobStore(jobsPath)
    assert.equal(store.all().length, 0)
  })
})
