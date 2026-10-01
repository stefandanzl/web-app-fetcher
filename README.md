# web-app-fetcher

A downloader for [OpenCloud Web](https://github.com/opencloud-eu/web). Adds a
**"Download from URL"** entry to the files app upload menu: paste an HTTP(S)
URL or magnet link, optionally provide basic auth / custom HTTP headers, pick
a target folder (defaults to the current one) — the file is fetched and saved
straight into OpenCloud. No Uppy involved.

## Two download modes

### Server-side (recommended): the bridge

`bridge/` contains a small Node.js applet (no runtime dependencies) that runs
next to your OpenCloud server in one container together with
[aria2](https://aria2.github.io/):

```
browser ──"download this"──▶ bridge ──▶ aria2 (downloads to a staging dir)
                                   └── on completion: WebDAV upload into
                                       OpenCloud as the requesting user
```

- URLs **and magnet/torrent** links, with optional basic auth and arbitrary
  HTTP headers (e.g. `Cookie` headers copied from your browser devtools to
  download from cloud providers)
- no CORS restrictions — the server fetches, not the browser
- downloads survive page reloads, browser shutdowns and bridge restarts
  (aria2 session persistence); progress is visible from any device of the user
- files are uploaded through OpenCloud's WebDAV API with the logged-in
  user's token (forwarded per request, never stored beyond the download),
  so permissions and quotas of that user apply

Configure it via `apps.yaml`:

```yaml
fetcher:
  config:
    bridgeUrl: 'https://your-opencloud-host/fetcher'
```

and route the `/fetcher` path prefix to the bridge container behind whatever
reverse proxy fronts your OpenCloud (or expose its port directly and point
`bridgeUrl` at it — CORS headers are sent either way).

**Bridge environment** (see `bridge/Dockerfile` / the repo `docker-compose.yml`):

| Variable      | Meaning                                                                                |
| ------------- | -------------------------------------------------------------------------------------- |
| `OC_URL`      | base URL of the OpenCloud server (container-to-container is fine)                      |
| `RPC_SECRET`  | secret for the internal aria2 JSON-RPC channel                                         |
| `DATA_DIR`    | staging dir shared by bridge and aria2 (default `/data`)                               |
| `ARIA2_URL`   | optional: drive an external aria2 instead of the embedded one (must share `DATA_DIR`!) |
| `BT_TRACKERS` | optional: comma/newline separated tracker list (empty = DHT/PEX only)                  |
| `PORT`        | http port of the bridge (default 3000)                                                 |

### Browser-side fallback

Without a `bridgeUrl` the extension downloads in the browser: simpler, zero
infrastructure, but subject to CORS (the remote server must allow it) and urls
only — no torrents. Large files are buffered in memory.

## Security notes

- The bridge authenticates every request by asking OpenCloud which user the
  presented token belongs to; job ids are random 128-bit capabilities.
- Header/auth values passed to a download persist in plaintext in aria2's
  session file (container-local) for the duration of the download. No
  credential storage of any other kind exists, by design.
- `jobs.json` (targets + tokens of _pending_ downloads) is written with
  `0600` permissions; tokens of finished/failed jobs are wiped.

## Development

```bash
task build        # build the extension
task test:unit    # extension unit tests
task bridge:build # build the bridge
task bridge:test  # bridge unit tests
```

The dev environment of the [web-extensions monorepo](https://github.com/opencloud-eu/web-extensions)
wires everything up via `docker-compose.yml` (mounts the extension dist and
runs the bridge behind traefik at `/fetcher`).

## Credits

Project structure and build setup inspired by
[opencloud-eu/web-app-skeleton](https://github.com/opencloud-eu/web-app-skeleton).
