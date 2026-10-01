import { createReadStream, readdirSync, statSync, type Dirent } from 'node:fs'
import { basename, join, relative } from 'node:path'

/** thrown when opencloud rejects the stored token - job goes to awaiting-login */
export class AuthNeededError extends Error {
  constructor() {
    super('opencloud rejected the stored token')
    this.name = 'AuthNeededError'
  }
}

export interface UploadRequest {
  ocUrl: string
  spaceId: string
  /** absolute folder path inside the space ('' or starting with '/') */
  targetPath: string
  /** user-chosen name: file name for single files, folder name otherwise */
  fileName: string | null
  stagingDir: string
  token: string
}

export interface UploadResult {
  /** paths relative to the target folder, e.g. 'sintel/sintel.mp4' */
  files: string[]
}

/**
 * Builds a safe, encoded webdav path. Rejects '.'/'..' segments so nothing
 * can ever escape the target folder.
 */
export function encodeDavPath(path: string): string {
  const segments = path.split('/').filter((segment) => segment.length > 0)
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`illegal path segment in "${path}"`)
  }
  return `/${segments.map(encodeURIComponent).join('/')}`
}

async function davRequest(
  url: string,
  token: string,
  method: 'MKCOL' | 'PUT',
  extra: { body?: NodeJS.ReadableStream } = {}
): Promise<Response> {
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(method === 'PUT' ? { 'content-type': 'application/octet-stream' } : {})
    }
  }
  if (extra.body) {
    // node streams are valid fetch bodies, but the dom typings disagree - hence the cast
    init.body = extra.body as unknown as RequestInit['body']
    init.duplex = 'half'
  }
  const response = await fetch(url, init)
  if (response.status === 401 || response.status === 403) {
    throw new AuthNeededError()
  }
  return response
}

async function ensureFolder(davBase: string, token: string, folderPath: string): Promise<void> {
  const response = await davRequest(`${davBase}${encodeDavPath(folderPath)}/`, token, 'MKCOL')
  // 201 created, 405 already exists - both fine
  if (!response.ok && response.status !== 405) {
    throw new Error(`MKCOL ${folderPath} failed: ${response.status} ${response.statusText}`)
  }
}

function contentEntries(dir: string): Dirent[] {
  return readdirSync(dir, { withFileTypes: true }).filter((entry) => !entry.name.endsWith('.aria2'))
}

function collectFiles(dir: string, base = dir): Array<{ absolute: string; relative: string }> {
  const files: Array<{ absolute: string; relative: string }> = []
  for (const entry of contentEntries(dir)) {
    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFiles(absolute, base))
    } else if (entry.isFile()) {
      files.push({ absolute, relative: relative(base, absolute) })
    }
  }
  return files
}

/**
 * Uploads everything below the staging dir into the target folder.
 * - single file  -> targetPath/<fileName or original name>
 * - torrent/multi -> targetPath/<fileName or torrent folder name>/<...>
 */
export async function uploadStagingDir(request: UploadRequest): Promise<UploadResult> {
  const { ocUrl, spaceId, targetPath, fileName, stagingDir, token } = request
  const davBase = `${ocUrl}/dav/spaces/${encodeURIComponent(spaceId)}`
  const targetBase = targetPath.replace(/\/+$/, '')

  const entries = contentEntries(stagingDir)
  if (!entries.length) {
    throw new Error('nothing to upload: staging dir is empty')
  }

  // single file: goes straight into the target folder
  if (entries.length === 1 && entries[0].isFile()) {
    const name = fileName || entries[0].name
    const absolute = join(stagingDir, entries[0].name)
    const size = statSync(absolute).size
    const response = await davRequest(
      `${davBase}${encodeDavPath(`${targetBase}/${name}`)}`,
      token,
      'PUT',
      {
        body: createReadStream(absolute)
      }
    )
    if (!response.ok) {
      throw new Error(
        `upload of ${name} failed: ${response.status} ${response.statusText} (${size} bytes)`
      )
    }
    return { files: [name] }
  }

  // multi-file (usually a torrent): everything lands in a named subfolder
  const rootName =
    fileName ||
    (entries.length === 1 && entries[0].isDirectory() ? entries[0].name : basename(stagingDir))
  const targetFolder = `${targetBase}/${rootName}`
  const files = collectFiles(stagingDir).sort((a, b) => a.relative.localeCompare(b.relative))

  const createdFolders = new Set<string>()
  const ensureFolderDeep = async (folder: string): Promise<void> => {
    let current = ''
    for (const segment of folder.split('/').filter(Boolean)) {
      current += `/${segment}`
      if (createdFolders.has(current)) {
        continue
      }
      await ensureFolder(davBase, token, current)
      createdFolders.add(current)
    }
  }

  await ensureFolderDeep(targetFolder)
  const uploaded: string[] = []

  for (const file of files) {
    const relativeDir = file.relative.includes('/')
      ? file.relative.slice(0, file.relative.lastIndexOf('/'))
      : ''
    const destinationFolder = relativeDir ? `${targetFolder}/${relativeDir}` : targetFolder
    await ensureFolderDeep(destinationFolder)

    const size = statSync(file.absolute).size
    const response = await davRequest(
      `${davBase}${encodeDavPath(`${destinationFolder}/${basename(file.relative)}`)}`,
      token,
      'PUT',
      { body: createReadStream(file.absolute) }
    )
    if (!response.ok) {
      throw new Error(
        `upload of ${rootName}/${file.relative} failed: ${response.status} ${response.statusText} (${size} bytes)`
      )
    }
    uploaded.push(`${rootName}/${file.relative}`)
  }

  return { files: uploaded }
}
