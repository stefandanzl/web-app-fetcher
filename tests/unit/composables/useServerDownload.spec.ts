import { getComposableWrapper } from '@opencloud-eu/web-test-helpers'
import { useServerDownload } from '../../../src/composables/useServerDownload'

describe('useServerDownload', () => {
  it('sends the user token and payload when starting a download', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'job-1', state: 'queued' }), { status: 201 })
      )
    vi.stubGlobal('fetch', fetchMock)

    await getComposableWrapper(
      () => {
        const { startDownload } = useServerDownload('https://bridge.example.com/')
        return startDownload({
          url: 'magnet:?xt=urn:btih:abc',
          headers: [{ name: 'Cookie', value: 'yum' }],
          fileName: 'my torrent',
          target: { spaceId: 'space-1', path: '/Videos' }
        }).then((job) => {
          expect(job.id).toEqual('job-1')
          expect(fetchMock).toHaveBeenCalledWith(
            'https://bridge.example.com/api/downloads',
            expect.objectContaining({
              method: 'POST',
              headers: expect.objectContaining({ authorization: 'Bearer token-1' })
            })
          )
          const body = JSON.parse(fetchMock.mock.calls[0][1].body)
          expect(body.url).toEqual('magnet:?xt=urn:btih:abc')
          expect(body.headers).toEqual([{ name: 'Cookie', value: 'yum' }])
          expect(body.target).toEqual({ spaceId: 'space-1', path: '/Videos' })
        })
      },
      { pluginOptions: { piniaOptions: { authState: { accessToken: 'token-1' } } } }
    )
  })

  it('surfaces bridge error messages', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'aria2 refused the download' }), { status: 502 })
      )
    vi.stubGlobal('fetch', fetchMock)

    await getComposableWrapper(
      () => {
        const { listDownloads } = useServerDownload('https://bridge.example.com')
        return expect(listDownloads()).rejects.toThrow('aria2 refused the download')
      },
      { pluginOptions: { piniaOptions: { authState: { accessToken: 'token-1' } } } }
    )
  })

  it('requests a single job by id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'abc', state: 'downloading' }), { status: 200 })
      )
    vi.stubGlobal('fetch', fetchMock)

    await getComposableWrapper(
      () => {
        const { getDownload } = useServerDownload('https://bridge.example.com')
        return getDownload('abc').then((job) => {
          expect(job.state).toEqual('downloading')
          expect(fetchMock.mock.calls[0][0]).toEqual('https://bridge.example.com/api/downloads/abc')
        })
      },
      { pluginOptions: { piniaOptions: { authState: { accessToken: 'token-1' } } } }
    )
  })
})
