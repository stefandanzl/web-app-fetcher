import { useMessages } from '@opencloud-eu/web-pkg'
import { useGettext } from 'vue3-gettext'
import { useServerDownload, type ServerJob, type ServerJobState } from './useServerDownload'

const POLL_INTERVAL_MS = 2000
const ACTIVE_STATES: ServerJobState[] = ['queued', 'downloading', 'uploading', 'awaiting-login']

/**
 * Background companion to the modal: checks once on app start which of our
 * downloads are running on the bridge (works cross-device, no local state),
 * keeps polling while anything is active and toasts on completion/failure.
 */
export const useDownloadsWatcher = (bridgeUrl: string) => {
  const { showMessage, showErrorMessage } = useMessages()
  const { $gettext } = useGettext()
  const { listDownloads } = useServerDownload(bridgeUrl)

  const knownStates = new Map<string, ServerJobState>()
  let timer: ReturnType<typeof setInterval> | null = null

  const notifyTransitions = (jobs: ServerJob[]): void => {
    const seenIds = new Set(jobs.map((job) => job.id))
    for (const job of jobs) {
      const previous = knownStates.get(job.id)
      knownStates.set(job.id, job.state)
      // jobs we learn about for the first time never toast - only transitions do
      if (previous === undefined || previous === job.state) {
        continue
      }
      if (job.state === 'complete') {
        showMessage({
          title: $gettext('"%{name}" has been downloaded', { name: job.fileName || job.url }),
          status: 'success'
        })
      } else if (job.state === 'error') {
        showErrorMessage({ title: $gettext('Download failed'), desc: job.error ?? undefined })
      }
    }
    for (const id of [...knownStates.keys()]) {
      if (!seenIds.has(id)) {
        knownStates.delete(id)
      }
    }
  }

  const startPolling = (): void => {
    if (timer) {
      return
    }
    timer = setInterval(() => {
      void tick()
    }, POLL_INTERVAL_MS)
  }

  const stopPolling = (): void => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  /** returns whether any of our jobs are still active */
  const tick = async (): Promise<boolean> => {
    let jobs: ServerJob[]
    try {
      jobs = await listDownloads()
    } catch {
      // bridge unreachable - stop polling, the next check/app load retries
      stopPolling()
      return false
    }
    notifyTransitions(jobs)
    return jobs.some((job) => ACTIVE_STATES.includes(job.state))
  }

  /** call on app start, or after a download was started elsewhere (e.g. the modal) */
  const check = (): void => {
    void tick().then((active) => {
      if (active) {
        startPolling()
      }
    })
  }

  return { check }
}
