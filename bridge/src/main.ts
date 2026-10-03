import { mkdirSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { basename, join } from 'node:path'
import { Aria2Client, Aria2RpcError, startAria2, type Aria2Status } from './aria2'
import { loadConfig, type BridgeConfig } from './config'
import { Identity } from './identity'
import { JobStore, toPublicJob, type Job } from './jobs'
import { AuthNeededError, encodeDavPath, uploadStagingDir } from './uploader'

const MAX_BODY_BYTES = 1024 * 1024

interface CreateDownloadBody {
  url?: unknown
  auth?: { username?: unknown; password?: unknown }
  headers?: Array<{ name?: unknown; value?: unknown }>
  fileName?: unknown
  target?: { spaceId?: unknown; path?: unknown }
}

function setCors(response: ServerResponse): void {
  response.setHeader('access-control-allow-origin', '*')
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  response.setHeader('access-control-allow-headers', 'authorization, content-type')
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) {
      throw new Error('request body too large')
    }
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    return null
  }
  return header.slice(7).trim() || null
}

function isValidUrl(url: string): boolean {
  if (url.startsWith('magnet:?')) {
    return true
  }
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** what aria2 gets told for this job */
function aria2OptionsFor(
  config: BridgeConfig,
  body: CreateDownloadBody,
  jobId: string
): Record<string, unknown> {
  const options: Record<string, unknown> = {
    dir: join(config.dataDir, jobId),
    'allow-overwrite': 'true',
    'auto-file-renaming': 'false'
  }

  const headers = (body.headers ?? [])
    .filter(
      (header) =>
        typeof header?.name === 'string' && typeof header?.value === 'string' && header.name
    )
    .map((header) => `${header.name}: ${header.value}`)

  const hasAuthorizationHeader = headers.some((header) =>
    header.toLowerCase().startsWith('authorization:')
  )
  const username = typeof body.auth?.username === 'string' ? body.auth.username : ''
  const password = typeof body.auth?.password === 'string' ? body.auth.password : ''

  // basic-auth fields are sugar for the authorization header - explicit header wins
  if (username && !hasAuthorizationHeader) {
    options['http-user'] = username
    options['http-passwd'] = password
  }

  if (headers.length) {
    options.header = headers
  }

  return options
}

function deriveFileName(job: Job, status: Aria2Status): void {
  if (job.fileName) {
    return
  }
  const files = (status.files ?? []).filter((file) => !file.path.endsWith('.aria2'))
  if (files.length === 1) {
    job.fileName = basename(files[0].path)
  }
  // multi-file downloads keep fileName empty - the uploader names the folder
}

class Bridge {
  private readonly config: BridgeConfig
  private readonly jobs: JobStore
  private readonly aria2: Aria2Client

  constructor(config: BridgeConfig, jobs: JobStore, aria2: Aria2Client) {
    this.config = config
    this.jobs = jobs
    this.aria2 = aria2
  }

  stagingDir(job: Job): string {
    return join(this.config.dataDir, job.id)
  }

  async tryUpload(job: Job): Promise<void> {
    this.jobs.update(job.id, { state: 'uploading' })
    try {
      await uploadStagingDir({
        ocUrl: this.config.ocUrl,
        spaceId: job.target.spaceId,
        targetPath: job.target.path,
        fileName: job.fileName,
        stagingDir: this.stagingDir(job),
        token: job.token
      })
      this.jobs.update(job.id, { state: 'complete', error: null, token: '' })
      rmSync(this.stagingDir(job), { recursive: true, force: true })
      console.log(`job ${job.id}: uploaded to ${job.target.path}`)
    } catch (error) {
      if (error instanceof AuthNeededError) {
        // the stored token expired; the owner's next poll brings a fresh one
        this.jobs.update(job.id, {
          state: 'awaiting-login',
          error: 'waiting for a fresh login token'
        })
      } else {
        const message = error instanceof Error ? error.message : String(error)
        this.jobs.update(job.id, { state: 'error', error: message, token: '' })
        console.error(`job ${job.id}: upload failed:`, message)
      }
    }
  }

  async pollTick(): Promise<void> {
    for (const job of this.jobs.all()) {
      if (job.state === 'awaiting-login' && job.token) {
        // a poll may have refreshed the token in the meantime
        await this.tryUpload(job)
        continue
      }

      if (job.state !== 'queued' && job.state !== 'downloading') {
        continue
      }
      if (!job.gid) {
        continue
      }

      let status: Aria2Status
      try {
        status = await this.aria2.tellStatus(job.gid)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const vanished = error instanceof Aria2RpcError && message.includes('is not found')
        this.jobs.update(job.id, {
          state: 'error',
          error: vanished ? 'download vanished (aria2 restarted without its session?)' : message
        })
        continue
      }

      const loaded = Number(status.completedLength)
      const total = Number(status.totalLength)
      this.jobs.update(job.id, {
        progress: { loaded, total, speed: Number(status.downloadSpeed) },
        state: status.status === 'active' ? 'downloading' : job.state
      })

      if (status.status === 'complete') {
        deriveFileName(job, status)
        await this.tryUpload(job)
      } else if (status.status === 'error' || status.status === 'removed') {
        this.jobs.update(job.id, {
          state: 'error',
          token: '',
          error:
            status.errorMessage ||
            `download ${status.status} (code ${status.errorCode ?? 'unknown'})`
        })
      }
    }

    this.jobs.prune(this.config.jobRetentionMs)
  }

  /** after a bridge restart, gids are stale - match aria2's active downloads to our jobs via their dir */
  async reassociate(): Promise<void> {
    const pending = this.jobs
      .all()
      .filter((job) => job.state === 'queued' || job.state === 'downloading')
    if (!pending.length) {
      return
    }

    const downloads = [...(await this.aria2.tellActive()), ...(await this.aria2.tellWaiting())]
    for (const download of downloads) {
      const options = await this.aria2
        .getOption(download.gid)
        .catch((): Record<string, string> | null => null)
      const jobId = options?.dir ? basename(options.dir) : null
      const job = jobId ? pending.find((candidate) => candidate.id === jobId) : null
      if (job) {
        this.jobs.update(job.id, { gid: download.gid })
        console.log(`job ${job.id}: re-associated with gid ${download.gid}`)
      }
    }

    // jobs we could not re-associate are dead - aria2 lost them
    for (const job of pending) {
      if (!this.jobs.get(job.id)?.gid) {
        this.jobs.update(job.id, {
          state: 'error',
          token: '',
          error: 'download not found after restart'
        })
      }
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig()
  mkdirSync(config.dataDir, { recursive: true })

  if (config.spawnAria2) {
    startAria2(config)
  }

  const aria2 = new Aria2Client(
    config.aria2Url ?? 'http://127.0.0.1:6800/jsonrpc',
    config.rpcSecret
  )
  const identity = new Identity(config.ocUrl)
  const jobs = new JobStore(join(config.dataDir, 'jobs.json'))
  const bridge = new Bridge(config, jobs, aria2)

  // wait for the rpc interface to come up (aria2 needs a moment after spawn)
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await aria2.call('aria2.getVersion')
      break
    } catch (error) {
      if (attempt === 29) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  await bridge.reassociate()

  const server = createServer(async (request, response) => {
    setCors(response)

    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    const url = new URL(request.url ?? '/', 'http://localhost')
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { status: 'ok' })
      return
    }

    if (!url.pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'not found' })
      return
    }

    const token = bearerToken(request)
    if (!token) {
      sendJson(response, 401, { error: 'authorization required' })
      return
    }
    const userId = await identity.userIdFor(token)
    if (!userId) {
      sendJson(response, 401, { error: 'invalid token' })
      return
    }

    try {
      if (request.method === 'GET' && url.pathname === '/api/downloads') {
        sendJson(response, 200, jobs.byUser(userId).map(toPublicJob))
        return
      }

      const singleMatch = url.pathname.match(/^\/api\/downloads\/([a-f0-9]+)$/)
      if (request.method === 'GET' && singleMatch) {
        const job = jobs.get(singleMatch[1])
        if (!job || job.userId !== userId) {
          // 404 for foreign jobs: their existence must not leak
          sendJson(response, 404, { error: 'not found' })
          return
        }
        if (job.state === 'awaiting-login' && job.token && job.token !== token) {
          // the browser brought a fresh token - remember it and retry the upload
          jobs.update(job.id, { token })
        }
        sendJson(response, 200, toPublicJob(job))
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/downloads') {
        const body = JSON.parse(
          (await readBody(request)).toString('utf8') || '{}'
        ) as CreateDownloadBody

        const targetUrl = typeof body.url === 'string' ? body.url.trim() : ''
        if (!isValidUrl(targetUrl)) {
          sendJson(response, 400, { error: 'url must be http(s) or a magnet link' })
          return
        }

        const spaceId = typeof body.target?.spaceId === 'string' ? body.target.spaceId : ''
        const targetPath = typeof body.target?.path === 'string' ? body.target.path : '/'
        if (!spaceId) {
          sendJson(response, 400, { error: 'target.spaceId is required' })
          return
        }
        try {
          encodeDavPath(targetPath)
        } catch {
          sendJson(response, 400, { error: 'target.path is not a valid path' })
          return
        }

        const fileName =
          typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim() : null

        const job = jobs.create({
          userId,
          token,
          url: targetUrl,
          fileName,
          target: { spaceId, path: targetPath }
        })

        let gid: string
        try {
          gid = await aria2.addUri([targetUrl], aria2OptionsFor(config, body, job.id))
        } catch (error) {
          jobs.update(job.id, {
            state: 'error',
            token: '',
            error: error instanceof Error ? error.message : String(error)
          })
          sendJson(response, 502, { error: 'aria2 refused the download', details: job.error })
          return
        }

        jobs.update(job.id, { gid, state: 'downloading' })
        sendJson(response, 201, toPublicJob(jobs.get(job.id)!))
        return
      }

      sendJson(response, 404, { error: 'not found' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`request failed (${request.method} ${url.pathname}):`, message)
      sendJson(response, 500, { error: message })
    }
  })

  server.listen(config.port, () => {
    console.log(`fetcher bridge listening on :${config.port}, opencloud at ${config.ocUrl}`)
  })

  const pollTimer = setInterval(() => {
    bridge.pollTick().catch((error) => console.error('poll tick failed:', error))
  }, config.pollIntervalMs)
  pollTimer.unref()

  const shutdown = (): void => {
    console.log('shutting down')
    clearInterval(pollTimer)
    server.close(() => process.exit(0))
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((error) => {
  console.error('fatal:', error)
  process.exit(1)
})
