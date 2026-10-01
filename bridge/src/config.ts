export interface BridgeConfig {
  /** http port the bridge listens on */
  port: number
  /** base url of the opencloud server, e.g. https://host.docker.internal:9200 (no trailing slash) */
  ocUrl: string
  /** directory shared with aria2: staging dirs, jobs.json, aria2 session/dht state */
  dataDir: string
  /** secret for the aria2 json-rpc api */
  rpcSecret: string
  /** when set, drive an external aria2 instead of spawning one (must share dataDir!) */
  aria2Url: string | null
  /** spawn aria2c as a child process (default: true unless aria2Url is set) */
  spawnAria2: boolean
  /** bt-tracker list handed to aria2 (empty = rely on dht/pex/torrent trackers) */
  btTrackers: string[]
  /** how often the bridge polls aria2, in milliseconds */
  pollIntervalMs: number
  /** finished/errored jobs are kept in jobs.json for this long, in milliseconds */
  jobRetentionMs: number
}

const truthy = (value: string | undefined): boolean =>
  !!value && !['false', '0', 'no', 'off'].includes(value.toLowerCase())

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const ocUrl = (env.OC_URL || '').replace(/\/+$/, '')
  if (!ocUrl) {
    throw new Error('OC_URL must be set, e.g. OC_URL=https://cloud.example.com')
  }

  const aria2Url = env.ARIA2_URL ? env.ARIA2_URL.replace(/\/+$/, '') : null

  return {
    port: Number(env.PORT) || 3000,
    ocUrl,
    dataDir: env.DATA_DIR || './data',
    rpcSecret: env.RPC_SECRET || '',
    aria2Url,
    spawnAria2: aria2Url ? truthy(env.SPAWN_ARIA2) : env.SPAWN_ARIA2 !== 'false',
    btTrackers: (env.BT_TRACKERS || '')
      .split(/[\n,]+/)
      .map((tracker) => tracker.trim())
      .filter(Boolean),
    pollIntervalMs: Number(env.POLL_INTERVAL_MS) || 2000,
    jobRetentionMs: Number(env.JOB_RETENTION_MS) || 24 * 60 * 60 * 1000
  }
}
