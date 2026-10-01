import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, mkdirSync, openSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BridgeConfig } from './config'

export interface Aria2File {
  path: string
}

/** subset of aria2's tellStatus result that we care about */
export interface Aria2Status {
  gid: string
  status: 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed'
  totalLength: string
  completedLength: string
  downloadSpeed: string
  errorCode?: string
  errorMessage?: string
  dir?: string
  files?: Aria2File[]
  [key: string]: unknown
}

interface JsonRpcResponse<T> {
  jsonrpc: string
  id: number
  result?: T
  error?: { code: number; message: string }
}

export class Aria2Client {
  private nextId = 1

  constructor(
    private readonly url: string,
    private readonly secret: string
  ) {}

  async call<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.nextId++,
        method,
        params: [`token:${this.secret}`, ...params]
      })
    })
    if (!response.ok) {
      throw new Error(`aria2 rpc http ${response.status} for ${method}`)
    }
    const body = (await response.json()) as JsonRpcResponse<T>
    if (body.error) {
      throw new Aria2RpcError(method, body.error.message)
    }
    return body.result as T
  }

  addUri(uris: string[], options: Record<string, unknown>): Promise<string> {
    return this.call<string>('aria2.addUri', [uris, options])
  }

  tellStatus(gid: string): Promise<Aria2Status> {
    return this.call<Aria2Status>('aria2.tellStatus', [gid])
  }

  tellActive(): Promise<Aria2Status[]> {
    return this.call<Aria2Status[]>('aria2.tellActive', [])
  }

  tellWaiting(offset = 0, num = 100): Promise<Aria2Status[]> {
    return this.call<Aria2Status[]>('aria2.tellWaiting', [offset, num])
  }

  getOption(gid: string): Promise<Record<string, string>> {
    return this.call<Record<string, string>>('aria2.getOption', [gid])
  }
}

export class Aria2RpcError extends Error {
  constructor(method: string, message: string) {
    super(`aria2 ${method}: ${message}`)
    this.name = 'Aria2RpcError'
  }
}

/**
 * Writes the runtime aria2.conf into the data dir. Values borrowed from the
 * battle-tested P3TERX/aria2.conf defaults, minus every hook script: the
 * bridge is the only thing touching finished downloads.
 */
export function buildAria2Config(config: BridgeConfig): string {
  const lines = [
    `dir=${config.dataDir}`,
    // persistence: downloads survive restarts
    'continue=true',
    `input-file=${join(config.dataDir, 'aria2.session')}`,
    `save-session=${join(config.dataDir, 'aria2.session')}`,
    'save-session-interval=10',
    'auto-save-interval=20',
    // retry behaviour
    'max-tries=5',
    'retry-wait=10',
    'connect-timeout=10',
    'timeout=60',
    'remote-time=true',
    // throughput
    'max-concurrent-downloads=5',
    'max-connection-per-server=16',
    'split=16',
    'min-split-size=4M',
    'file-allocation=none',
    'disk-cache=32M',
    'http-accept-gzip=true',
    'content-disposition-default-utf8=true',
    // some servers reject default clients
    'user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    // bittorrent
    'follow-torrent=true',
    'bt-save-metadata=true',
    'bt-load-saved-metadata=true',
    'bt-detach-seed-only=true',
    'seed-ratio=1.0',
    'seed-time=0',
    'bt-request-peer-speed-limit=10M',
    'max-overall-upload-limit=2M',
    'listen-port=6888',
    'dht-listen-port=6888',
    'enable-dht=true',
    'enable-dht6=false',
    `dht-file-path=${join(config.dataDir, 'dht.dat')}`,
    'dht-entry-point=dht.transmissionbt.com:6881',
    'bt-enable-lpd=true',
    'enable-peer-exchange=true',
    'bt-max-peers=128',
    // rpc
    'enable-rpc=true',
    'rpc-listen-all=false',
    'rpc-listen-port=6800',
    'rpc-secret=' + config.rpcSecret,
    'rpc-save-upload-metadata=true',
    // misc
    'disable-ipv6=false',
    'quiet=false',
    'console-log-level=notice'
  ]

  if (config.btTrackers.length) {
    lines.push(`bt-tracker=${config.btTrackers.join(',')}`)
  }

  return lines.join('\n') + '\n'
}

/**
 * Spawns aria2c as a child process supervised by the bridge: if the engine
 * dies, the bridge dies with it and the container restart policy recovers
 * both. Returns the child so the caller can kill it on shutdown.
 */
export function startAria2(config: BridgeConfig): ChildProcess {
  const confPath = join(config.dataDir, 'aria2.conf')
  mkdirSync(config.dataDir, { recursive: true })
  writeFileSync(confPath, buildAria2Config(config))

  // aria2 refuses to start when input-file is set but missing - create it empty
  const sessionPath = join(config.dataDir, 'aria2.session')
  closeSync(openSync(sessionPath, 'a'))

  const child = spawn('aria2c', ['--conf-path', confPath], {
    stdio: ['ignore', 'inherit', 'inherit']
  })

  child.on('exit', (code, signal) => {
    console.error(`aria2 exited (code ${code}, signal ${signal}) - shutting bridge down`)
    process.exit(1)
  })

  return child
}
