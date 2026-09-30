import { ActionExtension, useModals, useSpacesStore } from '@opencloud-eu/web-pkg'
import { Resource, SpaceResource } from '@opencloud-eu/web-client'
import { defaultComponentMocks, getComposableWrapper } from '@opencloud-eu/web-test-helpers'
import { mock } from 'vitest-mock-extended'
import { unref } from 'vue'
import { useExtensions } from '../../../src/composables/useExtensions'

describe('fetcher action', () => {
  describe('isVisible', () => {
    it('is false in public link context', () => {
      getWrapper({
        currentFolder: mock<Resource>({ canUpload: () => true }),
        publicLinkContextReady: true,
        setup: (instance) => {
          const action = (unref(instance)[0] as ActionExtension).action
          expect(action.isVisible()).toBeFalsy()
        }
      })
    })
    it('is false on generic space view when no write access is given', () => {
      getWrapper({
        currentFolder: mock<Resource>({ canUpload: () => false }),
        setup: (instance) => {
          const action = (unref(instance)[0] as ActionExtension).action
          expect(action.isVisible()).toBeFalsy()
        }
      })
    })
    it('is true on generic space view when write access is given', () => {
      getWrapper({
        currentFolder: mock<Resource>({ canUpload: () => true }),
        setup: (instance) => {
          const action = (unref(instance)[0] as ActionExtension).action
          expect(action.isVisible()).toBeTruthy()
        }
      })
    })
  })
  describe('handler', () => {
    it('dispatches the download modal with the current folder as default target', () => {
      getWrapper({
        currentFolder: mock<Resource>({
          canUpload: () => true,
          path: '/documents',
          name: 'documents'
        }),
        setup: (instance) => {
          // stubbed pinia actions are no-ops, so the ref is assigned directly
          useSpacesStore().currentSpace = mock<SpaceResource>({ id: 'space-id' })
          const spy = vi.spyOn(useModals(), 'dispatchModal')
          const action = (unref(instance)[0] as ActionExtension).action
          action.handler()
          expect(spy).toHaveBeenCalledTimes(1)
          const modalOptions = spy.mock.calls[0][0]
          expect(modalOptions.customComponent).toBeDefined()
          expect(modalOptions.customComponentAttrs().currentPath).toEqual('/documents')
          expect((modalOptions.customComponentAttrs().space as SpaceResource).id).toEqual(
            'space-id'
          )
        }
      })
    })
  })
})

function getWrapper({
  setup,
  currentFolder,
  publicLinkContextReady = false
}: {
  setup: (instance: ReturnType<typeof useExtensions>) => void
  currentFolder?: Resource
  publicLinkContextReady?: boolean
}) {
  const mocks = { ...defaultComponentMocks() }

  return {
    wrapper: getComposableWrapper(
      () => {
        const instance = useExtensions()
        setup(instance)
      },
      {
        mocks,
        provide: mocks,
        pluginOptions: {
          piniaOptions: { resourcesStore: { currentFolder }, authState: { publicLinkContextReady } }
        }
      }
    )
  }
}
