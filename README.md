# SportsHub 0.2.9

SportsHub is a self-hosted sports addon for Nuvio. It combines your sports sources with live games, upcoming fixtures, and matchup artwork.

**[Start Setup →](https://reelhumann-glitch.github.io/sportshub/)**

The wizard guides you through sources, optional catalog selection, Cloudflare deployment, and installation in Nuvio.

<details>
<summary>Manual browser setup and troubleshooting</summary>

## Deploy in your browser

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Freelhumann-glitch%2Fsportshub)

Use the Deploy to Cloudflare button to copy this project into your own GitHub account and deploy it to your own Cloudflare Worker. Enter your own configured AIOStreams manifest URL or one or more supported direct addon URLs in the **Secrets** section. Leave unused fields blank. When deployment finishes, open the Worker’s HTTPS URL, append `/manifest.json`, and install that URL in Nuvio.

If you need to add or update a source after deployment, open your Worker in **Workers & Pages → Settings → Variables and Secrets**. Add the value as a **Secret** using the names below.

1. Click **Deploy to Cloudflare** and connect your GitHub account if prompted.
2. Choose a Worker name and fill in `AIOSTREAMS_MANIFEST_URL` or the matching direct source secret fields. Leave unused fields blank. You can also add secrets in the Worker settings after deploying.
3. Deploy. Copy the Worker’s HTTPS address, append `/manifest.json`, and open it in your browser to check that it returns the SportsHub manifest.
4. In Nuvio, open **Settings → Addons → Add Addon**, paste the SportsHub manifest URL, and install it. Open **Live Now** or **Upcoming Today** to check the setup.
5. Optionally paste the wizard’s `SPORTHUB_CATALOGS` value into Cloudflare to choose sport and league rows. Leave it blank for the standard catalogs.
6. Optionally paste the wizard’s `SPORTHUB_STREAM_LANGUAGES` value into Cloudflare. Leave it blank for English preferred, which includes unlabeled feeds.

### Optional AIOStreams template

1. **Configure each addon first.** Open its own setup page, save the options you want, and copy its configured manifest URL. Repeat for every addon you plan to use.
2. Open the [raw AIOStreams template](https://raw.githubusercontent.com/reelhumann-glitch/sportshub/main/aiostreams-template.json). Use that URL for a template URL import. For a file import, save the raw page as `aiostreams-template.json` and select that file in the template picker.
3. Start a fresh sports configuration, paste at least one configured addon manifest into its matching field, and save. The template supplies its own addon list and preserves upstream stream labels.
4. Copy the new AIOStreams manifest URL into your Cloudflare `AIOSTREAMS_MANIFEST_URL` secret.

SportsHub handles its own sport and league filters, highlights exclusion, language rules, and resolution-first sorting. The template connects the sources and leaves AIOStreams' filters and other preferences at the values already set in that configuration. Install the SportsHub manifest in Nuvio to see the curated catalogs.

If you see `JSON.parse: unexpected character at line 1 column 1`, check that your file opens as JSON beginning with `{`. GitHub's regular file preview is an HTML page. Use the raw link above to get the JSON.

The template was built from scratch with blank inputs. It contains no existing manifest URLs, configuration identifiers or account credentials.

</details>

<details>
<summary>Terminal setup and technical details</summary>

## Terminal setup

You’ll need Node.js 22.12 or newer, a Cloudflare Workers account, and at least one supported addon manifest URL. Extract the ZIP and open a terminal in the extracted folder. In Windows PowerShell, use `npm.cmd` if `npm` is blocked by your execution policy.

```sh
npm ci
node setup.mjs
```

Choose `aio` for your own configured AIOStreams manifest, or enter any combination of `nuvio, highfly, cnc` for direct addons. You can combine AIOStreams and direct sources. The setup opens Cloudflare login, deploys the Worker, and prompts for each chosen manifest URL using Wrangler’s secret input. If Wrangler asks you to choose an account, select the same account throughout. Add `/manifest.json` to the HTTPS Worker URL that Wrangler prints and install it in Nuvio.

The Worker uses the default `workers.dev` route and needs no paid bindings or custom domain. If your account already has a Worker named `sportshub-addon`, change `name` in `wrangler.toml` before running setup to create a separate deployment.

## Supported sources

| Source | Secret | Expected catalog |
| --- | --- | --- |
| AIOStreams | `AIOSTREAMS_MANIFEST_URL` | Configured sports addons exposing their live catalogs |
| NuvioLiveSports | `NUVIO_MANIFEST_URL` | `nuvio_sports_live` |
| HighFly Sports | `HIGHFLY_MANIFEST_URL` | `sports_live` |
| CNCVerse | `CNC_MANIFEST_URL` | `cnc_SportzXLiveEvents_tv` |

SportsHub recognizes NuvioLiveSports, HighFly Sports, CNCVerse, and PenguPlay through AIOStreams. It uses AIOStreams routes when advertised and falls back to configured direct bindings when those routes are unavailable. Source availability, supported catalog fields, and playback vary by addon. SportsHub uses a fixed set of source adapters.

Keep your source manifests in Cloudflare secrets. Your Worker URL serves catalog and stream responses, so share this package with other users and use your deployed URL for your own setup.

## Manual setup and checks

Install dependencies with `npm ci`, sign into your own account with `npx wrangler login`, run `npm run deploy`, then set each source using `npx wrangler secret put SECRET_NAME`. On Windows PowerShell, use `npx.cmd` if needed.

## Sports metadata

SportsHub uses the built-in public TheSportsDB key for fixture metadata. The [official PWHL schedule](https://www.thepwhl.com/en/schedule) works without a key and feeds Upcoming Today, Hockey, and the optional PWHL catalog.

SportsHub caches fixture snapshots for 10 minutes at each Cloudflare edge location and can reuse up to six hours of recent fixtures when an upstream source fails. API-Sports data refreshes at most hourly per catalog mode and edge location when the cache is available. The artwork renderer can use team logos supplied by addons when a metadata logo is missing or fails to load.

- `/manifest.json` returns the install manifest.
- `/diagnostics/providers.json` reports source catalog status without returning manifest URLs.
- `npm test` runs the local tests.

For local development, copy `.dev.vars.example` to `.dev.vars`, add your own source URLs, and run `npm run dev`. The included Atkinson Hyperlegible Next font license is in `assets/OFL.txt`.

</details>
