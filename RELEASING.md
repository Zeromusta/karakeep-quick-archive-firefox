# Packaging and distribution

There's a few paths to ship this. Pick based on how often you'll
update and how many machines you need to support.

## Option 1 — Temporary load (zero overhead, no persistence)

Load via `about:debugging` as described in the [README](README.md).
Gone on restart. Fine for a single dev machine; impractical for daily
use.

## Option 2 — Mozilla self-distribution signing (recommended)

Mozilla will sign the `.xpi` without listing it publicly on
addons.mozilla.org (AMO). Once signed, regular Firefox installs it
permanently and auto-updates from a feed you host yourself.

The repo ships a GitHub Actions workflow that does the whole release
pipeline. Pushing a `vX.Y.Z` tag runs tests, signs the build, publishes
it to a GitHub Release, and refreshes the auto-update feed on the
`gh-pages` branch.

### One-time setup

1. **Mozilla API credentials.** Create a free account at
   <https://addons.mozilla.org/developers/> and generate API
   credentials at
   <https://addons.mozilla.org/developers/addon/api/key/>.
   Add them to the GitHub repo under
   **Settings → Secrets and variables → Actions → New repository secret**:
   - `AMO_JWT_ISSUER` — the API key (issuer JWT field).
   - `AMO_JWT_SECRET` — the API secret.
2. **Extension identity in `manifest.json`.** Already configured:
   ```jsonc
   "browser_specific_settings": {
     "gecko": {
       "id": "karakeep-quick-archive@zeromusta.com",
       "strict_min_version": "128.0",
       "update_url": "https://zeromusta.github.io/karakeep-quick-archive-firefox/updates.json"
     }
   }
   ```
   The `id` is permanent — changing it later means Firefox treats the
   result as a different extension and won't update existing installs.
   The `id` deliberately omits the `-firefox` suffix that's in the repo
   name; the `update_url` follows the repo name because it's the GitHub
   Pages host.
3. **GitHub Pages.** After the first release runs and pushes to the
   `gh-pages` branch, go to **Settings → Pages** and set
   *Build and deployment* → *Source: Deploy from a branch*, branch
   `gh-pages`, folder `/ (root)`. The feed then lives at
   <https://zeromusta.github.io/karakeep-quick-archive-firefox/updates.json>.
   Note: GitHub Pages on a private repo requires GitHub Pro. The repo
   needs to be public (or on Pro) for Firefox to fetch the feed and
   the signed `.xpi` from Releases.

### Cut a release

```bash
git tag v1.0.1
git push origin v1.0.1
```

The [`Release` workflow](.github/workflows/release.yml) then:

1. Runs `npm test`.
2. Rewrites `manifest.json`'s `version` field to match the tag.
3. Calls `web-ext sign --channel=unlisted` (AMO signs and returns the
   `.xpi`; first submission auto-registers the extension on AMO under
   the self-distributed channel).
4. Renames the artifact to `karakeep-quick-archive-firefox-<version>.xpi` and
   attaches it to a new GitHub Release named after the tag.
5. Regenerates `updates.json` pointing at that release's `.xpi` and
   publishes it to the `gh-pages` branch.

Firefox polls `update_url` on its own schedule (roughly daily); to
force a check, open `about:addons` and use the gear menu →
*Check for Updates*.

### Manual one-off signing (without the workflow)

```bash
npm install -g web-ext
web-ext sign --channel=unlisted \
  --api-key "$AMO_JWT_ISSUER" \
  --api-secret "$AMO_JWT_SECRET"
```

Output lands in `web-ext-artifacts/`. Install by dragging the `.xpi`
into Firefox, or host it and update `updates.json` by hand.

**Reference:** <https://extensionworkshop.com/documentation/manage/updating-your-extension/>

## Option 3 — List on addons.mozilla.org

Same submission flow, but choose **On this site** for distribution.
Mozilla reviews the code (turnaround typically a few days), then lists
it publicly. Users install with one click from the AMO page, and updates
are automatic via AMO's CDN — no `update_url` to host.

Worth it if you ever want to share the extension beyond yourself.
Overkill for a personal tool.

## Option 4 — Firefox Developer Edition / ESR / Nightly with signature checks off

Set `xpinstall.signatures.required = false` in `about:config` on
Firefox Developer Edition, ESR, or Nightly. Then any unsigned `.xpi`
will install permanently. Won't work on regular Firefox (stable),
which enforces signing.

Useful if you don't want to deal with AMO at all and run a non-stable
channel anyway.
