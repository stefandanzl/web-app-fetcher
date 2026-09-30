import { useClientService, useResourcesStore } from '@opencloud-eu/web-pkg'
import type { SpaceResource } from '@opencloud-eu/web-client'
import { urlJoin } from '@opencloud-eu/web-client'
import { useGettext } from 'vue3-gettext'
import { unref } from 'vue'

export type DownloadPhase = 'idle' | 'downloading' | 'uploading' | 'done' | 'error'

export interface DownloadOptions {
  url: string
  username?: string
  password?: string
  space: SpaceResource
  targetPath: string
  onPhase?: (phase: DownloadPhase) => void
  onProgress?: (loaded: number, total: number) => void
  signal?: AbortSignal
}

export interface DownloadResult {
  fileName: string
  size: number
}

export const getFilenameFromHeaders = (response: Response): string | null => {
  const disposition = response.headers.get('content-disposition')
  if (!disposition) {
    return null
  }
  const utf8Match = disposition.match(/filename\*=(?:UTF-8'')?([^;]+)/i)
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1].replaceAll('"', ''))
    } catch {
      // fall through to the plain filename variant
    }
  }
  const match = disposition.match(/filename="?([^";]+)"?/i)
  return match ? match[1] : null
}

export const getFilenameFromUrl = (url: string): string | null => {
  try {
    const { pathname } = new URL(url)
    const name = pathname.split('/').filter(Boolean).pop()
    return name ? decodeURIComponent(name) : null
  } catch {
    return null
  }
}

export const useDownload = () => {
  const clientService = useClientService()
  const resourcesStore = useResourcesStore()
  const { $gettext } = useGettext()

  const downloadFile = async ({
    url,
    username,
    password,
    space,
    targetPath,
    onPhase,
    onProgress,
    signal
  }: DownloadOptions): Promise<DownloadResult> => {
    const headers: Record<string, string> = {}
    if (username || password) {
      const credentials = btoa(`${username ?? ''}:${password ?? ''}`)
      headers.Authorization = `Basic ${credentials}`
    }

    let response: Response
    try {
      response = await fetch(url, { headers, signal })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }
      throw new Error(
        $gettext(
          'Could not reach the URL. The server might be offline or does not allow cross-origin requests (CORS).'
        )
      )
    }

    if (!response.ok) {
      throw new Error(
        $gettext('The server responded with status code %{status}.', {
          status: String(response.status)
        })
      )
    }

    const fileName = getFilenameFromHeaders(response) || getFilenameFromUrl(url) || 'download'
    const total = Number(response.headers.get('content-length')) || 0

    onPhase('downloading')

    let blob: Blob
    if (response.body) {
      const reader = response.body.getReader()
      const chunks: BlobPart[] = []
      let loaded = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        chunks.push(value)
        loaded += value.byteLength
        onProgress?.(loaded, total)
      }
      blob = new Blob(chunks)
    } else {
      blob = await response.blob()
      onProgress?.(blob.size, blob.size)
    }

    onPhase('uploading')

    const content = await blob.arrayBuffer()
    const resource = await clientService.webdav.putFileContents(unref(space), {
      path: urlJoin(targetPath, fileName),
      content,
      overwrite: true,
      onUploadProgress: (event) => onProgress?.(event.loaded, event.total ?? 0)
    })

    onPhase('done')

    // make the file show up immediately when it was downloaded into the open folder
    const currentPath = unref(resourcesStore.currentFolder)?.path
    if (currentPath === targetPath) {
      resourcesStore.upsertResource(resource)
    }

    return { fileName, size: content.byteLength }
  }

  return { downloadFile }
}
