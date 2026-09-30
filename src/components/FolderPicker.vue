<script setup lang="ts">
import type { Resource, SpaceResource } from '@opencloud-eu/web-client'
import { useClientService, useMessages } from '@opencloud-eu/web-pkg'
import { useGettext } from 'vue3-gettext'
import { computed, ref, unref, watch } from 'vue'

const props = defineProps<{
  space?: SpaceResource
  initialPath: string
}>()

const emit = defineEmits<{
  select: [path: string, name: string]
  cancel: []
}>()

const { $gettext } = useGettext()
const clientService = useClientService()
const { showErrorMessage } = useMessages()

const path = ref(props.initialPath)
const folders = ref<Resource[]>([])
const loading = ref(false)

const loadFolders = async () => {
  if (!props.space) {
    return
  }
  loading.value = true
  try {
    const { children } = await clientService.webdav.listFiles(unref(props.space), {
      path: unref(path)
    })
    folders.value = (children ?? []).filter((child) => child.isFolder)
  } catch (error) {
    console.error(error)
    showErrorMessage({
      title: $gettext('Could not load folders'),
      errors: [error instanceof Error ? error : new Error(String(error))]
    })
  } finally {
    loading.value = false
  }
}

watch(path, loadFolders, { immediate: true })

const breadcrumbs = computed(() => {
  const segments = unref(path).split('/').filter(Boolean)
  const crumbs = [{ name: $gettext('All files'), path: '/' }]
  let current = ''
  for (const segment of segments) {
    current += `/${segment}`
    crumbs.push({ name: segment, path: current })
  }
  return crumbs
})

const currentFolderName = computed(() => {
  const segments = unref(path).split('/').filter(Boolean)
  return segments.length ? segments[segments.length - 1] : $gettext('All files')
})

const parentPath = computed(() => {
  const segments = unref(path).split('/').filter(Boolean)
  segments.pop()
  return `/${segments.join('/')}`.replace('//', '/')
})
</script>

<template>
  <div class="ext:flex ext:flex-col ext:gap-3">
    <div class="ext:flex ext:items-center ext:gap-1 ext:text-sm ext:flex-wrap">
      <span v-if="path !== '/'">
        <button
          type="button"
          class="ext:cursor-pointer ext:underline"
          data-testid="fetcher-folder-picker-up"
          @click="path = parentPath"
        >
          ..
        </button>
        /
      </span>
      <template v-for="(crumb, index) in breadcrumbs" :key="crumb.path">
        <span v-if="index > 0">/</span>
        <button
          type="button"
          class="ext:cursor-pointer"
          :class="index < breadcrumbs.length - 1 ? 'ext:underline' : 'ext:font-semibold'"
          :data-testid="`fetcher-folder-picker-breadcrumb-${index}`"
          @click="path = crumb.path"
        >
          {{ crumb.name }}
        </button>
      </template>
    </div>

    <div class="ext:max-h-64 ext:overflow-y-auto ext:rounded ext:border ext:p-2">
      <div v-if="loading" class="ext:p-4 ext:text-center ext:text-sm">
        {{ $gettext('Loading folders…') }}
      </div>
      <div v-else-if="!folders.length" class="ext:p-4 ext:text-center ext:text-sm">
        {{ $gettext('No subfolders') }}
      </div>
      <ul v-else class="ext:flex ext:flex-col">
        <li v-for="folder in folders" :key="folder.id">
          <button
            type="button"
            class="ext:flex ext:w-full ext:cursor-pointer ext:items-center ext:gap-2 ext:rounded ext:px-2 ext:py-1 ext:text-left hover:ext:bg-[var(--oc-color-background-highlight])"
            :data-testid="`fetcher-folder-picker-folder-${folder.name}`"
            @click="path = folder.path"
          >
            <oc-icon name="folder" size="small" fill-type="line" />
            <span>{{ folder.name }}</span>
          </button>
        </li>
      </ul>
    </div>

    <div class="ext:flex ext:justify-between ext:gap-2">
      <button
        type="button"
        class="ext:cursor-pointer ext:py-1"
        data-testid="fetcher-folder-picker-cancel"
        @click="emit('cancel')"
      >
        {{ $gettext('Back') }}
      </button>
      <button
        type="button"
        class="ext:cursor-pointer ext:rounded ext:px-4 ext:py-1 ext:font-semibold ext:text-white ext:bg-[var(--oc-color-swatch-brand-default)]"
        data-testid="fetcher-folder-picker-select"
        @click="emit('select', path, currentFolderName)"
      >
        {{ $gettext('Choose this folder') }}
      </button>
    </div>
  </div>
</template>
