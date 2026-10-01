# Changelog

## [1.1.0](https://github.com/stefandanzl/web-app-fetcher/releases/tag/fetcher-v1.1.0) - 2026-10-01

### ✨ Features

- Server-side downloads via the new `fetcher-bridge` (`bridge/`): aria2 does the
  downloading, the bridge uploads into OpenCloud as the requesting user - no
  CORS restrictions, downloads continue across page reloads and devices
- BitTorrent support: paste magnet links into the same URL field
- Custom HTTP headers per download (cookies, bearer tokens, referer, ...) as a
  manual replacement for the importer's cloud-provider integrations
- Editable file name (pre-filled from the URL), background progress watcher
  with completion/error notifications
- Browser-side download stays available as fallback when no bridge is configured

## [1.0.0](https://github.com/opencloud-eu/web-extensions/releases/tag/fetcher-v1.0.0) - 2026-09-30

### ✨ Features

- Initial release: "Download from URL" action in the files app upload menu with
  optional basic authentication and a target folder picker (defaults to the
  current folder)
