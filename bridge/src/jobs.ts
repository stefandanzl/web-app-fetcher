import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export type JobState =
  'queued' | 'downloading' | 'uploading' | 'awaiting-login' | 'complete' | 'error'

export interface JobTarget {
  spaceId: string
  /** absolute path inside the space, '' or starting with '/' */
  path: string
}

export interface JobProgress {
  loaded: number
  total: number
  speed: number
}

export interface Job {
  /** our own unguessable id, also the name of the staging dir */
  id: string
  /** aria2's gid - changes when aria2 reloads its session, never used as key */
  gid: string | null
  /** stable user id from opencloud userinfo */
  userId: string
  /** the freshest token the owner handed us; wiped on terminal states */
  token: string
  url: string
  /** user-chosen name; derived from the download result when empty */
  fileName: string | null
  target: JobTarget
  state: JobState
  error: string | null
  progress: JobProgress
  createdAt: number
  updatedAt: number
}

export type PublicJob = Omit<Job, 'token' | 'userId' | 'gid'>

export function toPublicJob(job: Job): PublicJob {
  // explicit field list: the public representation must never grow a secret by accident
  return {
    id: job.id,
    url: job.url,
    fileName: job.fileName,
    target: job.target,
    state: job.state,
    error: job.error,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  }
}

export interface PersistedJob extends Omit<Job, 'token'> {
  /** tokens of terminal jobs are not persisted */
  token?: string
}

export class JobStore {
  private jobs = new Map<string, Job>()

  constructor(private readonly filePath: string) {
    this.load()
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      return
    }
    try {
      const persisted = JSON.parse(readFileSync(this.filePath, 'utf8')) as PersistedJob[]
      for (const entry of persisted) {
        this.jobs.set(entry.id, { ...entry, token: entry.token ?? '' })
      }
      console.log(`loaded ${this.jobs.size} job(s) from ${this.filePath}`)
    } catch (error) {
      // a corrupt jobs.json must never brick the bridge - start empty
      console.error(`could not parse ${this.filePath}, starting without jobs:`, error)
    }
  }

  /** atomic write (tmp file + rename), readable only by the bridge user */
  save(): void {
    const persisted: PersistedJob[] = [...this.jobs.values()].map((job) => {
      const isTerminal = job.state === 'complete' || job.state === 'error'
      const { token, ...rest } = job
      return { ...rest, token: isTerminal ? undefined : token }
    })
    const tmpPath = `${this.filePath}.tmp`
    writeFileSync(tmpPath, JSON.stringify(persisted, null, 2))
    chmodSync(tmpPath, 0o600)
    renameSync(tmpPath, this.filePath)
  }

  create(input: {
    userId: string
    token: string
    url: string
    fileName: string | null
    target: JobTarget
  }): Job {
    const job: Job = {
      id: randomBytes(16).toString('hex'),
      gid: null,
      userId: input.userId,
      token: input.token,
      url: input.url,
      fileName: input.fileName,
      target: input.target,
      state: 'queued',
      error: null,
      progress: { loaded: 0, total: 0, speed: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    this.jobs.set(job.id, job)
    this.save()
    return job
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id)
  }

  all(): Job[] {
    return [...this.jobs.values()]
  }

  byUser(userId: string): Job[] {
    return this.all().filter((job) => job.userId === userId)
  }

  update(id: string, patch: Partial<Job>): Job {
    const job = this.jobs.get(id)
    if (!job) {
      throw new Error(`no job ${id}`)
    }
    Object.assign(job, { ...patch, updatedAt: patch.updatedAt ?? Date.now() })
    this.save()
    return job
  }

  prune(retentionMs: number): void {
    const now = Date.now()
    const stale = this.all().filter(
      (job) =>
        (job.state === 'complete' || job.state === 'error') && now - job.updatedAt > retentionMs
    )
    if (stale.length) {
      for (const job of stale) {
        this.jobs.delete(job.id)
      }
      this.save()
    }
  }

  /** staging dir name == job id, by construction */
  stagingDirFor(job: Job, dataDir: string): string {
    return join(dataDir, job.id)
  }
}
