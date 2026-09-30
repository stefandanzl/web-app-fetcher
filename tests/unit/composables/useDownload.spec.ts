import { Resource, SpaceResource } from '@opencloud-eu/web-client'
import { defaultComponentMocks, getComposableWrapper } from '@opencloud-eu/web-test-helpers'
import { mock } from 'vitest-mock-extended'
import {
  useDownload,
  getFilenameFromHeaders,
  getFilenameFromUrl
} from '../../../src/composables/useDownload'

describe('filename helpers', () => {
  describe('getFilenameFromUrl', () => {
    it.each([
      ['https://example.com/files/archive.zip', 'archive.zip'],
      ['https://example.com/files/a%20b.txt?query=1#frag', 'a b.txt'],
      ['https://example.com/', null]
    ])('derives the filename from %s', (url, expected) => {
      expect(getFilenameFromUrl(url)).toEqual(expected)
    })
  })
  describe('getFilenameFromHeaders', () => {
    it('prefers the utf-8 filename*', () => {
      const response = new Response('x', {
        headers: {
          'content-disposition':
            'attachment; filename="fallback.txt"; filename*=UTF-8\'\'n%C3%A4me.txt'
        }
      })
      expect(getFilenameFromHeaders(response)).toEqual('näme.txt')
    })
    it('falls back to the plain filename', () => {
      const response = new Response('x', {
        headers: { 'content-disposition': 'attachment; filename="fallback.txt"' }
      })
      expect(getFilenameFromHeaders(response)).toEqual('fallback.txt')
    })
    it('returns null without the header', () => {
      expect(getFilenameFromHeaders(new Response('x'))).toBeNull()
    })
  })
})

describe('downloadFile', () => {
  it('downloads the url and uploads the file into the target folder', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('hello world', {
        headers: { 'content-disposition': 'attachment; filename="test.txt"' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const phases: string[] = []
    const progress: Array<[number, number]> = []

    await runWithDownload(async ({ downloadFile, clientService }) => {
      const result = await downloadFile({
        url: 'https://example.com/some/file',
        space: mock<SpaceResource>({ id: 'space-id' }),
        targetPath: '/documents',
        onPhase: (phase) => phases.push(phase),
        onProgress: (loaded, total) => progress.push([loaded, total])
      })

      expect(fetchMock).toHaveBeenCalledWith('https://example.com/some/file', {
        headers: {},
        signal: undefined
      })
      expect(clientService.webdav.putFileContents).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'space-id' }),
        expect.objectContaining({ path: '/documents/test.txt', overwrite: true })
      )
      expect(result.fileName).toEqual('test.txt')
      expect(result.size).toEqual(11)
      expect(phases).toEqual(['downloading', 'uploading', 'done'])
      expect(progress[progress.length - 1]).toEqual([11, 11])
    })
  })

  it('sends basic auth credentials when given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('x'))
    vi.stubGlobal('fetch', fetchMock)

    await runWithDownload(async ({ downloadFile }) => {
      await downloadFile({
        url: 'https://example.com/file.txt',
        username: 'alice',
        password: 'secret',
        space: mock<SpaceResource>({ id: 'space-id' }),
        targetPath: '/'
      })

      const authorization = fetchMock.mock.calls[0][1].headers.Authorization
      expect(authorization).toEqual(`Basic ${btoa('alice:secret')}`)
    })
  })

  it('throws a friendly error when the url is not reachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await runWithDownload(async ({ downloadFile }) => {
      await expect(
        downloadFile({
          url: 'https://offline.example.com/file.txt',
          space: mock<SpaceResource>({ id: 'space-id' }),
          targetPath: '/'
        })
      ).rejects.toThrow('Could not reach the URL')
    })
  })

  it('throws when the server responds with an error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })))

    await runWithDownload(async ({ downloadFile }) => {
      await expect(
        downloadFile({
          url: 'https://example.com/missing.txt',
          space: mock<SpaceResource>({ id: 'space-id' }),
          targetPath: '/'
        })
      ).rejects.toThrow('404')
    })
  })
})

function runWithDownload(
  setup: (context: {
    downloadFile: ReturnType<typeof useDownload>['downloadFile']
    clientService: ReturnType<typeof defaultComponentMocks>['$clientService']
  }) => Promise<void>
) {
  const mocks = { ...defaultComponentMocks() }
  mocks.$clientService.webdav.putFileContents.mockResolvedValue(mock<Resource>({ id: 'new-file' }))

  return getComposableWrapper(
    () => {
      const { downloadFile } = useDownload()
      return setup({ downloadFile, clientService: mocks.$clientService })
    },
    {
      mocks,
      provide: mocks,
      pluginOptions: {
        piniaOptions: { resourcesStore: { currentFolder: mock<Resource>({ path: '/documents' }) } }
      }
    }
  )
}
