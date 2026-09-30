# web-app-fetcher

A simple downloader for [OpenCloud Web](https://github.com/opencloud-eu/web). Adds a
**"Download from URL"** entry to the files app upload menu: paste an HTTP(S) URL,
optionally provide basic-auth credentials, pick a target folder (defaults to the
current one) and the file is fetched and saved straight into OpenCloud.

No Uppy involved.

## Status

**Milestone 1 — client-side proof of concept.**

- The URL is downloaded by the browser, so the remote server must allow
  cross-origin requests (CORS). URLs from most arbitrary servers and WebDAV
  servers without CORS headers will fail with a friendly error.
- The whole file is buffered in browser memory before upload — not suited for
  very large files yet.

Planned **milestone 2** removes both limits with a small server-side bridge
(aria2 + Node service): no CORS restrictions, torrent/magnet support and
streamed uploads.

## Development

```bash
task build      # production build (or: pnpm build)
task test:unit  # unit tests
```

Register the built app in your OpenCloud instance by mounting
`packages/web-app-fetcher/dist` into the server's web apps folder (see the
repository `docker-compose.yml` for the dev setup).

## Credits

Project structure and build setup inspired by
[opencloud-eu/web-app-skeleton](https://github.com/opencloud-eu/web-app-skeleton).
