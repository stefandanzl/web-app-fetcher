<script setup lang="ts">
import type { SpaceResource } from '@opencloud-eu/web-client'
import { formatFileSize, useMessages, useModals, type Modal } from '@opencloud-eu/web-pkg'
import { useGettext } from 'vue3-gettext'
import { computed, ref, unref, watch } from 'vue'
import { getFilenameFromUrl, useDownload, type DownloadPhase } from '../composables/useDownload'
import {
  useServerDownload,
  type ServerJob,
  type ServerJobState
} from '../composables/useServerDownload'
import FolderPicker from './FolderPicker.vue'

const props = defineProps<{
  modal: Modal
  space?: SpaceResource
  currentPath: string
  currentFolderName: string
  bridgeUrl?: string
  /** tells the background watcher to pick up a started server download */
  onServerDownloadStarted?: () => void
}>()

const { $gettext, current: currentLanguage } = useGettext()
const { removeModal } = useModals()
const { showMessage, showErrorMessage } = useMessages()
const { downloadFile } = useDownload()

const serverMode = computed(() => !!props.bridgeUrl)

const url = ref('')
const fileName = ref('')
const fileNameTouched = ref(false)
const useBasicAuth = ref(false)
const username = ref('')
const password = ref('')
const headers = ref<Array<{ name: string; value: string }>>([])
const showAdvanced = ref(false)
const targetPath = ref(props.currentPath)
const targetFolderName = ref(props.currentFolderName)
const showFolderPicker = ref(false)

const phase = ref<DownloadPhase | ServerJobState>('idle')
const loaded = ref(0)
const total = ref(0)
const errorMessage = ref('')
const abortController = ref<AbortController>()
const serverDownload = computed(() => (props.bridgeUrl ? useServerDownload(props.bridgeUrl) : null))

const isMagnet = computed(() => url.value.startsWith('magnet:'))
const isRunning = computed(() =>
  ['downloading', 'uploading', 'queued', 'awaiting-login'].includes(phase.value as string)
)
const isDownloadPhase = computed(() => phase.value === 'downloading')

const canStart = computed(() => {
  if (isRunning.value || showFolderPicker.value) {
    return false
  }
  if (isMagnet.value) {
    // torrents only exist server-side
    return !!serverMode.value && url.value.length > 'magnet:?'.length
  }
  try {
    const parsed = new URL(url.value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
})

const percent = computed(() => {
  if (!total.value) {
    return 0
  }
  return Math.min(100, Math.round((loaded.value / total.value) * 100))
})

const phaseLabel = computed(() => {
  if (phase.value === 'uploading') {
    return $gettext('Saving to OpenCloud…')
  }
  if (phase.value === 'awaiting-login') {
    return $gettext('Waiting for a fresh login token…')
  }
  return $gettext('Downloading…')
})

// pre-fill the file name from the url unless the user edited it manually
watch(url, (newUrl) => {
  if (!fileNameTouched.value) {
    fileName.value = getFilenameFromUrl(newUrl) ?? ''
  }
})

const close = () => {
  abortController.value?.abort()
  removeModal(props.modal.id)
}

const showSuccess = (name: string) => {
  showMessage({
    title: $gettext('"%{name}" has been downloaded', { name }),
    status: 'success'
  })
}

const startClientDownload = async () => {
  abortController.value = new AbortController()
  try {
    const result = await downloadFile({
      url: url.value,
      username: useBasicAuth.value ? username.value : undefined,
      password: useBasicAuth.value ? password.value : undefined,
      space: props.space,
      targetPath: targetPath.value,
      signal: abortController.value.signal,
      onPhase: (newPhase: DownloadPhase) => {
        phase.value = newPhase
      },
      onProgress: (newLoaded: number, newTotal: number) => {
        loaded.value = newLoaded
        total.value = newTotal
      }
    })
    showSuccess(result.fileName)
    removeModal(props.modal.id)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      phase.value = 'idle'
      return
    }
    phase.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : String(error)
    showErrorMessage({ title: $gettext('Download failed'), desc: errorMessage.value })
  }
}

const startServerDownload = async () => {
  if (!serverDownload.value || !props.space) {
    return
  }

  let job: ServerJob
  try {
    job = await serverDownload.value.startDownload({
      url: url.value,
      auth: useBasicAuth.value ? { username: username.value, password: password.value } : undefined,
      headers: headers.value.filter((header) => header.name.trim()),
      fileName: fileName.value.trim() || null,
      target: { spaceId: props.space.id, path: targetPath.value }
    })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
    phase.value = 'error'
    showErrorMessage({ title: $gettext('Could not start the download'), desc: errorMessage.value })
    return
  }

  props.onServerDownloadStarted?.()
  phase.value = job.state

  const poll = async (): Promise<void> => {
    try {
      job = await serverDownload.value.getDownload(job.id)
    } catch {
      // transient bridge hiccup - try again on the next tick
      return
    }
    phase.value = job.state
    loaded.value = job.progress.loaded
    total.value = job.progress.total

    if (job.state === 'complete') {
      showSuccess(job.fileName || fileName.value || url.value)
      removeModal(props.modal.id)
      return
    }
    if (job.state === 'error') {
      errorMessage.value = job.error ?? $gettext('Unknown error')
      showErrorMessage({ title: $gettext('Download failed'), desc: errorMessage.value })
      return
    }
    setTimeout(poll, 2000)
  }
  setTimeout(poll, 2000)
}

const start = () => {
  phase.value = 'downloading'
  loaded.value = 0
  total.value = 0
  errorMessage.value = ''
  if (serverMode.value) {
    void startServerDownload()
  } else {
    void startClientDownload()
  }
}

const addHeader = () => {
  headers.value.push({ name: '', value: '' })
}

const removeHeader = (index: number) => {
  headers.value.splice(index, 1)
}
</script>

<template>
  <div class="ext:flex ext:flex-col ext:gap-4">
    <template v-if="showFolderPicker">
      <folder-picker
        :space="space"
        :initial-path="targetPath"
        @select="
          (path: string, name: string) => {
            targetPath = path
            targetFolderName = name
            showFolderPicker = false
          }
        "
        @cancel="showFolderPicker = false"
      />
    </template>

    <template v-else>
      <label class="ext:flex ext:flex-col ext:gap-1">
        <span class="ext:font-semibold">
          {{ serverMode ? $gettext('URL or magnet link') : $gettext('URL') }}
        </span>
        <input
          v-model="url"
          type="url"
          :placeholder="
            serverMode
              ? $gettext('https://example.com/file.zip or magnet:?xt=…')
              : $gettext('https://example.com/file.zip')
          "
          :disabled="isRunning"
          class="ext:rounded ext:border ext:px-2 ext:py-1 ext:bg-transparent"
          data-testid="fetcher-url-input"
        />
        <span
          v-if="isMagnet && !serverMode"
          class="ext:text-sm ext:text-[var(--oc-color-swatch-danger-default)]"
        >
          {{ $gettext('Torrent downloads require the server-side bridge to be configured.') }}
        </span>
      </label>

      <label class="ext:flex ext:flex-col ext:gap-1">
        <span class="ext:font-semibold">{{ $gettext('File name') }}</span>
        <input
          v-model="fileName"
          type="text"
          :placeholder="
            isMagnet ? $gettext('Folder name (optional)') : $gettext('Automatic (from URL)')
          "
          :disabled="isRunning"
          class="ext:rounded ext:border ext:px-2 ext:py-1 ext:bg-transparent"
          data-testid="fetcher-filename-input"
          @input="fileNameTouched = true"
        />
      </label>

      <div>
        <button
          type="button"
          class="ext:cursor-pointer ext:underline"
          :disabled="isRunning"
          data-testid="fetcher-advanced-toggle"
          @click="showAdvanced = !showAdvanced"
        >
          {{ showAdvanced ? $gettext('Hide advanced options') : $gettext('Show advanced options') }}
        </button>

        <div v-if="showAdvanced" class="ext:mt-2 ext:flex ext:flex-col ext:gap-2">
          <label class="ext:flex ext:items-center ext:gap-2">
            <input
              v-model="useBasicAuth"
              type="checkbox"
              :disabled="isRunning"
              data-testid="fetcher-auth-toggle"
              autocomplete="off"
            />
            <span>{{ $gettext('Use basic authentication') }}</span>
          </label>
          <div v-if="useBasicAuth" class="ext:flex ext:gap-2">
            <input
              v-model="username"
              type="text"
              :placeholder="$gettext('Username')"
              :disabled="isRunning"
              autocomplete="off"
              class="ext:w-1/2 ext:rounded ext:border ext:px-2 ext:py-1 ext:bg-transparent"
              data-testid="fetcher-username-input"
            />
            <input
              v-model="password"
              type="password"
              :placeholder="$gettext('Password')"
              :disabled="isRunning"
              autocomplete="new-password"
              class="ext:w-1/2 ext:rounded ext:border ext:px-2 ext:py-1 ext:bg-transparent"
              data-testid="fetcher-password-input"
            />
          </div>

          <template v-if="serverMode">
            <span class="ext:text-sm ext:font-semibold">{{ $gettext('HTTP headers') }}</span>
            <div
              v-for="(header, index) in headers"
              :key="index"
              class="ext:flex ext:items-center ext:gap-1"
              :data-testid="`fetcher-header-row-${index}`"
            >
              <input
                v-model="header.name"
                type="text"
                :placeholder="$gettext('Header (e.g. Cookie)')"
                :disabled="isRunning"
                autocomplete="off"
                class="ext:w-2/5 ext:rounded ext:border ext:px-2 ext:py-1 ext:bg-transparent"
              />
              <input
                v-model="header.value"
                type="text"
                :placeholder="$gettext('Value')"
                :disabled="isRunning"
                autocomplete="off"
                class="ext:flex-1 ext:rounded ext:border ext:px-2 ext:py-1 ext:bg-transparent"
              />
              <button
                type="button"
                class="ext:cursor-pointer"
                :disabled="isRunning"
                :data-testid="`fetcher-header-remove-${index}`"
                @click="removeHeader(index)"
              >
                ✕
              </button>
            </div>
            <button
              type="button"
              class="ext:w-fit ext:cursor-pointer ext:underline"
              :disabled="isRunning"
              data-testid="fetcher-header-add"
              @click="addHeader"
            >
              {{ $gettext('Add header') }}
            </button>
            <span class="ext:text-xs ext:opacity-70">
              {{
                $gettext(
                  'Example: header "Cookie" with the value from your browser devtools to download from cloud providers.'
                )
              }}
            </span>
          </template>
        </div>
      </div>

      <div
        class="ext:flex ext:items-center ext:justify-between ext:gap-2 ext:rounded ext:border ext:px-2 ext:py-1"
      >
        <span class="ext:flex ext:items-center ext:gap-2 ext:overflow-hidden">
          <oc-icon name="folder" size="small" fill-type="line" />
          <span class="ext:truncate" :title="targetPath" data-testid="fetcher-target-folder">
            {{ targetFolderName }}
          </span>
        </span>
        <button
          type="button"
          class="ext:shrink-0 ext:cursor-pointer ext:underline"
          :disabled="isRunning"
          data-testid="fetcher-change-folder"
          @click="showFolderPicker = true"
        >
          {{ $gettext('Change folder') }}
        </button>
      </div>

      <div v-if="isRunning" class="ext:flex ext:flex-col ext:gap-1" data-testid="fetcher-progress">
        <div class="ext:h-1.5 ext:rounded ext:bg-[var(--oc-color-background-muted)]">
          <div
            class="ext:h-full ext:rounded ext:bg-[var(--oc-color-swatch-brand-default)] ext:transition-all"
            :style="{ width: `${percent}%` }"
          />
        </div>
        <span class="ext:text-sm">
          {{ phaseLabel }}
          <template v-if="total && isDownloadPhase">
            {{ percent }}% ({{ formatFileSize(loaded, unref(currentLanguage)) }} /
            {{ formatFileSize(total, unref(currentLanguage)) }})
          </template>
          <template v-else-if="loaded && isDownloadPhase">
            ({{ formatFileSize(loaded, unref(currentLanguage)) }})
          </template>
        </span>
        <span v-if="serverMode" class="ext:text-xs ext:opacity-70">
          {{ $gettext('Runs on the server - you can close this dialog, the download continues.') }}
        </span>
      </div>

      <div
        v-if="errorMessage"
        class="ext:text-sm ext:text-[var(--oc-color-swatch-danger-default)]"
        data-testid="fetcher-error"
      >
        {{ errorMessage }}
      </div>
    </template>

    <div class="ext:flex ext:justify-end ext:gap-2">
      <button
        type="button"
        class="ext:cursor-pointer ext:rounded ext:px-4 ext:py-1.5"
        data-testid="fetcher-cancel"
        @click="close"
      >
        {{ isRunning && serverMode ? $gettext('Hide') : $gettext('Cancel') }}
      </button>
      <button
        v-if="!showFolderPicker"
        type="button"
        class="ext:cursor-pointer ext:rounded ext:px-4 ext:py-1.5 ext:font-semibold ext:text-white ext:bg-[var(--oc-color-swatch-brand-default)] disabled:ext:opacity-50 disabled:ext:cursor-not-allowed"
        :disabled="!canStart"
        data-testid="fetcher-start"
        @click="start"
      >
        {{ isRunning ? $gettext('Downloading…') : $gettext('Download') }}
      </button>
    </div>
  </div>
</template>
