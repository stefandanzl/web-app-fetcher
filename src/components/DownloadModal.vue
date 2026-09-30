<script setup lang="ts">
import type { SpaceResource } from '@opencloud-eu/web-client'
import { formatFileSize, useMessages, useModals, type Modal } from '@opencloud-eu/web-pkg'
import { useGettext } from 'vue3-gettext'
import { computed, ref, unref } from 'vue'
import { useDownload, type DownloadPhase } from '../composables/useDownload'
import FolderPicker from './FolderPicker.vue'

const props = defineProps<{
  modal: Modal
  space?: SpaceResource
  currentPath: string
  currentFolderName: string
}>()

const { $gettext, current: currentLanguage } = useGettext()
const { removeModal } = useModals()
const { showMessage, showErrorMessage } = useMessages()
const { downloadFile } = useDownload()

const url = ref('')
const useBasicAuth = ref(false)
const username = ref('')
const password = ref('')
const targetPath = ref(props.currentPath)
const targetFolderName = ref(props.currentFolderName)
const showFolderPicker = ref(false)

const phase = ref<DownloadPhase>('idle')
const loaded = ref(0)
const total = ref(0)
const errorMessage = ref('')
const abortController = ref<AbortController>()

const isRunning = computed(() => ['downloading', 'uploading'].includes(phase.value))
const isDownloadPhase = computed(() => phase.value === 'downloading')
const canStart = computed(() => {
  if (isRunning.value || showFolderPicker.value) {
    return false
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
  if (isDownloadPhase.value) {
    return $gettext('Downloading…')
  }
  return $gettext('Saving to OpenCloud…')
})

const close = () => {
  abortController.value?.abort()
  removeModal(props.modal.id)
}

const start = async () => {
  phase.value = 'downloading'
  loaded.value = 0
  total.value = 0
  errorMessage.value = ''
  abortController.value = new AbortController()

  try {
    const { fileName, size } = await downloadFile({
      url: url.value,
      username: useBasicAuth.value ? username.value : undefined,
      password: useBasicAuth.value ? password.value : undefined,
      space: props.space,
      targetPath: targetPath.value,
      signal: abortController.value.signal,
      onPhase: (newPhase) => {
        phase.value = newPhase
      },
      onProgress: (newLoaded, newTotal) => {
        loaded.value = newLoaded
        total.value = newTotal
      }
    })

    showMessage({
      title: $gettext('"%{fileName}" has been downloaded (%{size})', {
        fileName,
        size: formatFileSize(size, unref(currentLanguage))
      }),
      status: 'success'
    })
    removeModal(props.modal.id)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      phase.value = 'idle'
      return
    }
    phase.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : String(error)
    showErrorMessage({
      title: $gettext('Download failed'),
      desc: errorMessage.value
    })
  }
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
        <span class="ext:font-semibold">{{ $gettext('URL') }}</span>
        <input
          v-model="url"
          type="url"
          :placeholder="$gettext('https://example.com/file.zip')"
          :disabled="isRunning"
          class="ext:rounded ext:border ext:px-2 ext:py-1 ext:bg-transparent"
          data-testid="fetcher-url-input"
        />
      </label>

      <div class="ext:flex ext:flex-col ext:gap-1">
        <label class="ext:flex ext:items-center ext:gap-2">
          <input
            v-model="useBasicAuth"
            type="checkbox"
            :disabled="isRunning"
            data-testid="fetcher-auth-toggle"
          />
          <span>{{ $gettext('Use basic authentication') }}</span>
        </label>
        <div v-if="useBasicAuth" class="ext:flex ext:gap-2">
          <input
            v-model="username"
            type="text"
            :placeholder="$gettext('Username')"
            :disabled="isRunning"
            class="ext:w-1/2 ext:rounded ext:border ext:px-2 ext:py-1 ext:bg-transparent"
            data-testid="fetcher-username-input"
          />
          <input
            v-model="password"
            type="password"
            :placeholder="$gettext('Password')"
            :disabled="isRunning"
            class="ext:w-1/2 ext:rounded ext:border ext:px-2 ext:py-1 ext:bg-transparent"
            data-testid="fetcher-password-input"
          />
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
          <template v-if="total">
            {{ percent }}% ({{ formatFileSize(loaded, unref(currentLanguage)) }} /
            {{ formatFileSize(total, unref(currentLanguage)) }})
          </template>
          <template v-else-if="loaded">
            ({{ formatFileSize(loaded, unref(currentLanguage)) }})
          </template>
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
        {{ $gettext('Cancel') }}
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
