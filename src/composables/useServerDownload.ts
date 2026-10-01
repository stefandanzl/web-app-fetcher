import { useAuthStore } from '@opencloud-eu/web-pkg'
import { unref } from 'vue'

export type ServerJobState =
  'queued' | 'downloading' | 'uploading' | 'awaiting-login' | 'complete' | 'error'

export interface ServerJob {
  id: string
  url: string
  fileName: string | null
  target: { spaceId: string; path: string }
  state: ServerJobState
  error: string | null
  progress: { loaded: number; total: number; speed: number }
  createdAt: number
  updatedAt: number
}

export interface StartServerDownloadOptions {
  url: string
  auth?: { username?: string; password?: string }
  headers?: Array<{ name: string; value: string }>
  fileName?: string | null
  target: { spaceId: string; path: string }
}

/**
 * Talks to the server-side bridge (aria2). The logged-in user's token goes
 * along with every request; the bridge uses it to upload into opencloud as
 * the user and to decide which jobs belong to us.
 */
export const useServerDownload = (bridgeUrl: string) => {
  const authStore = useAuthStore()
  const baseUrl = bridgeUrl.replace(/\/+$/, '')

  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${unref(authStore.accessToken)}`,
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
    if (!response.ok) {
      let message = `${response.status}`
      try {
        const errorBody = (await response.json()) as { error?: string }
        if (errorBody.error) {
          message = errorBody.error
        }
      } catch {
        // non-json error body, keep the status
      }
      throw new Error(message)
    }
    return (await response.json()) as T
  }

  return {
    startDownload: (options: StartServerDownloadOptions) =>
      request<ServerJob>('POST', '/api/downloads', options),
    listDownloads: () => request<ServerJob[]>('GET', '/api/downloads'),
    getDownload: (jobId: string) => request<ServerJob>('GET', `/api/downloads/${jobId}`)
  }
}
