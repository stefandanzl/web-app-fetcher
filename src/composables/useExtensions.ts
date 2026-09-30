import {
  Extension,
  useAuthStore,
  useModals,
  useResourcesStore,
  useSpacesStore,
  useUserStore
} from '@opencloud-eu/web-pkg'
import { storeToRefs } from 'pinia'
import { useGettext } from 'vue3-gettext'
import { computed, unref } from 'vue'
import DownloadModal from '../components/DownloadModal.vue'

export const useExtensions = () => {
  const { $gettext } = useGettext()
  const authStore = useAuthStore()
  const userStore = useUserStore()
  const resourcesStore = useResourcesStore()
  const { currentFolder } = storeToRefs(resourcesStore)
  const spacesStore = useSpacesStore()
  const { currentSpace, personalSpace } = storeToRefs(spacesStore)
  const { dispatchModal } = useModals()

  const canUpload = computed(() => {
    return unref(currentFolder)?.canUpload({ user: userStore.user })
  })

  // the upload menu invokes handlers without arguments, so the space is
  // resolved from the stores instead of the action options
  const handler = () => {
    dispatchModal({
      title: $gettext('Download from URL'),
      hideConfirmButton: true,
      hideCancelButton: true,
      customComponent: DownloadModal,
      customComponentAttrs: () => ({
        space: unref(currentSpace) ?? unref(personalSpace),
        currentPath: unref(currentFolder)?.path || '/',
        currentFolderName: unref(currentFolder)?.name || '/'
      })
    })
  }

  return computed<Extension[]>(() => [
    {
      id: 'com.github.opencloud-eu.web.fetch-url',
      type: 'action',
      extensionPointIds: ['app.files.upload-menu'],
      action: {
        name: 'fetch-url',
        icon: 'resource-type-url',
        iconFillType: 'fill',
        handler,
        label: () => $gettext('Download from URL'),
        isVisible: () => {
          if (authStore.publicLinkContextReady) {
            return false
          }
          return unref(canUpload)
        },
        class: 'oc-files-actions-fetch-url'
      }
    }
  ])
}
