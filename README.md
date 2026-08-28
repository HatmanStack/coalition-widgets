# Coalition widgets

Looker to S3 to a script tag.

**Unaffiliated concept work.** Not produced, authorised or endorsed by United Way of the Plains
or the Coalition to End Homelessness.

```
Looker  →  Lambda  →  s3://…/v1/data/*.json  →  CloudFront  →  <script> on a partner page
                          ↑
                    CodeBuild builds the bundle and publishes it to the same bucket
```

Two things deploy, separately, and they are not the same thing:

|                 |                      |                                                                         |
| --------------- | -------------------- | ----------------------------------------------------------------------- |
| **the widgets** | CloudFront over S3   | the bundle, `v1/manifest.json`, `v1/data/*.json`, `llm.txt`             |
| **the site**    | Amplify, from `web/` | a React app: what the widgets are, and a builder that assembles the tag |

A partner is given the site. The tag they paste from it points at the distribution, and their own
page then loads the bundle and the figures from there — so the site hosts pages and nothing else.
The preview on the builder is the real bundle reading the real figures over the real network,
which is the only reason it is worth having.

## The site

**<https://staging.d2b48lkm542els.amplifyapp.com/>** — Amplify, built from `web/`.

Two pages: what the widgets are, and a builder that assembles the tag so nobody hand-writes one
and finds out on a live page whether it parsed.

It hosts no widgets. Every widget on it is fetched from the distribution over the network using
the same tag it hands out, so the builder's preview is the real bundle reading the real figures
rather than a mock of them — and the tag a partner copies points at CloudFront, never at the
site. `web/.env` is what names the distribution, in development as well as in a build, so what
you see locally is the tag a partner is actually given.

```bash
npm run dev          # the widget origin on :8080 — the bundle, the data, llm.txt
cd web && npm run dev  # the site, which reads the deployed distribution
```

> **Deploy it through Amplify, not by uploading `dist/`.** `customHeaders` in `amplify.yml` are
> applied by the Amplify build; a manual upload skips them and the site goes out with no
> Content-Security-Policy, no HSTS and no `nosniff` — which is how it is serving today. The CSP
> also has to name the distribution in `script-src` and `connect-src`, and allow `font-src
> 'self'` for the two self-hosted faces. Miss any of those and the failure is silent: widgets
> simply absent, or the page falling back to system fonts.

To work against a bundle built on this machine instead, put
`VITE_WIDGET_ORIGIN=http://localhost:8080` in `web/.env.local`.

`web/public/llm.txt` is written by hand and served by the site. `npm test` checks that every
widget name in the catalogue appears in it and that every URL in it is the origin the site is
configured for — the two facts in it that can go silently out of date.

## Deploy

```bash
aws sso login --profile dev
npm install
npm run deploy
```

It asks for the Looker base URL and Look IDs, deploys the stack, then starts the CodeBuild
project that builds and publishes the bundle. The order is forced: the bundle bakes in the data
origin at build time and the origin is the CloudFront hostname, which does not exist until the
stack does.

Put the Looker credential in the secret the stack creates, as JSON:

```json
{ "client_id": "...", "client_secret": "..." }
```

There are two schedules, one per cadence, each passing its own `Input`:

| Cadence   | Parameter           | Default           | Writes                   |
| --------- | ------------------- | ----------------- | ------------------------ |
| quarterly | `QuarterlySchedule` | `rate(1 hour)`    | `v1/data/quarterly.json` |
| live      | `LiveSchedule`      | `rate(5 minutes)` | `v1/data/live.json`      |

Both ship `DISABLED`. Watch a manual run first, then enable:

```bash
aws lambda invoke --function-name <stack>-PublisherFunction-… \
  --payload '{"cadence":"quarterly"}' /dev/stdout
npm run deploy -- --yes   # with ScheduleState=ENABLED
```

An unrecognised cadence is refused before the secret is read, so a typo costs nothing and writes
nothing.

## Embed

After a build, the tag is at `https://<distribution>/v1/manifest.json`:

```html
<script
  src="https://d111111abcdef8.cloudfront.net/v1/chc.a1b2c3d4.js"
  integrity="sha384-…"
  crossorigin="anonymous"
  defer
  data-widgets="hmis-snapshot"
></script>
```

It renders where the tag sits. Paste it as many times as you like — the file is downloaded once
however many tags there are. Each tag is its own pane with its own store, so two tags reading the
same cadence each ask for that file and the browser's cache answers the second.

| Attribute      | Values                                                  | Default                        |
| -------------- | ------------------------------------------------------- | ------------------------------ |
| `data-widgets` | comma list from the widget table below, in render order | required                       |
| `data-theme`   | `auto` `light` `dark`                                   | `auto`, measured from the page |
| `data-size`    | `auto` `xs` `sm` `md` `lg` `xl`                         | `auto`, from container width   |
| `data-layout`  | `cards` `dashboard`                                     | `cards`                        |
| `data-table`   | `true` `false`                                          | `true`                         |
| `data-titles`  | `true` `false`                                          | `true`                         |
| `data-years`   | whole number, 1 or more                                 | the full published span        |
| `data-segment` | whichever the payload carries; `all` always works       | `all`                          |
| `data-target`  | CSS selector for an element already on the page         | where the tag sits             |

Nine, and the list is closed. `data-years` applies to `pit-trend` and `newly-homeless`,
`data-segment` to `inflow-outflow`; both are ignored elsewhere.

Any other value is refused and named on the page rather than quietly swapped for the default —
see below.

### Widgets

Freshest first.

| Name             | Reads     | Shows                                                |
| ---------------- | --------- | ---------------------------------------------------- |
| `queue-total`    | live      | people waiting for housing right now                 |
| `queue`          | weekly    | the queue: subgroups and how long people have waited |
| `hmis-snapshot`  | quarterly | the whole quarterly dashboard in one card            |
| `active-count`   | quarterly | people actively experiencing homelessness            |
| `race-ethnicity` | quarterly | sorted bars                                          |
| `county`         | quarterly | the county people lived in before, not where they are |
| `shelter-status` | quarterly | 100% stacked bar                                     |
| `pit-trend`      | annual    | the January census, sheltered against unsheltered    |
| `newly-homeless` | annual    | households becoming homeless each year               |
| `inflow-outflow` | annual    | became homeless against housed or exited             |
| `alice-gap`      | annual    | survival budget against median income                |
| `length-of-stay` | annual    | days homeless, local against national                |
| `retention`      | annual    | still housed two years on                            |

`queue` is the only one reading two files — a live headline over a weekly body — and is listed by
the slower of the two. Naming both would name the figure that moves and the figures to hold still
against it, which is the differencing the one-live-measure rule exists to prevent.

Theme is measured rather than declared: the bundle walks up from its host, finds the first
background with any opacity, and picks from its luminance. A partner with a dark page and a
system set to light gets a dark widget, which `prefers-color-scheme` would get wrong.

Every breakpoint is a container query. A widget in a 320px sidebar on a 1440px desktop is narrow,
and a media query would say it is wide.

## When something is wrong

**Take a photograph of the widget and hand it to an assistant along with this page.** Every
message carries a code, the value that was actually received, and the values that would have
worked, so the fix is a change to the script tag and nothing else. Nothing is written to the
browser console only — someone who does not write code will never open the console, so anything
visible only there does not exist.

A wrong optional attribute is reported _and_ the widget still renders beneath the message. A typo
never blanks a live page.

| Code     | Means                                                   | Fix                                                                                                 |
| -------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `CHC-01` | A name in `data-widgets` is not a widget.               | Use a name from the widget table. The message lists all of them.                                    |
| `CHC-02` | An attribute has a value that is not allowed.           | The message names the attribute, what it received, and the allowed values.                          |
| `CHC-03` | The data file could not be loaded.                      | Not a tag problem. Check the widget is not blocked by a content policy, then report it.             |
| `CHC-04` | The widget asked for a figure this data does not carry. | Usually `data-segment`. The message lists the segments that are published.                          |
| `CHC-05` | `data-target` matches no element on the page.           | Add an element with that id or class, or remove `data-target` and it renders where the tag sits.    |
| `CHC-06` | The container is under 240px wide.                      | Give it more room, or show fewer widgets side by side. It reappears on its own once there is space. |

### When it renders but looks wrong

No code appears for any of these, because nothing failed. They are still fixable from a
photograph and this table: each one is an attribute, not a bug report.

| What you see                                              | Why                                                                                                                                                                                                                                                                                                                                                | Add to the tag                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Light widget on a dark photo or gradient, or the reverse  | Theme is measured from the background **colour** of the elements above the widget. A background _image_ or gradient reports no colour, so the widget composites through to whatever sits behind it. Reading the actual pixels would need canvas, and partner imagery is almost never CORS-clean, so this gap cannot be closed by measuring harder. | `data-theme="dark"` or `data-theme="light"`                      |
| Theme right on load, wrong after a dark-mode toggle       | The toggle changes something the widget does not watch. It follows `class`, `style`, `data-theme`, `data-color-scheme` and `theme` on every ancestor.                                                                                                                                                                                              | `data-theme="…"` to pin it                                       |
| Text noticeably larger or smaller than the page around it | The widget inherits the page's font size, capped so an unusual host size cannot run away with the layout.                                                                                                                                                                                                                                          | `data-size="sm"` or `data-size="lg"`                             |
| One column with room to spare either side                 | Cards need 300px each, so a container under 600px fits one.                                                                                                                                                                                                                                                                                        | Widen the container, or `data-layout="dashboard"` to pack denser |
| A very long single column of cards                        | Many widgets in a narrow container.                                                                                                                                                                                                                                                                                                                | Fewer names in `data-widgets`, or `data-layout="dashboard"`      |

## What the Lambda refuses to publish

Nothing is written unless all of it passes:

- a named category below 5 people, or a remainder below 5, which is a small cell wearing a
  different label
- categories that do not sum to the universe they are stated against
- more than one measure on the live file, since two fast measures let an observer
  cross-difference successive snapshots
- a live measure under 100 people, where a change of one identifies somebody
- any label anywhere in the payload that looks like an identifier — an email address, a
  telephone number, a social security number, a full calendar date, a run of seven or more
  digits. Field _names_ are allowlisted, which stops a `client_email` column; this is the value
  in an allowlisted column. It runs first and alone, because every other refusal above quotes
  the label it is about and refusals are logged. It does not catch personal names, and cannot:
  "Sedgwick" is a county and a surname.

A failure writes nothing, leaves the previous file serving, and emits `PublishFailed`.

## Testing without Looker

There is no free Looker. No self-service trial, no public sandbox — an instance comes out of a
Google Cloud sales conversation, and Looker (Google Cloud core) Standard is a paid subscription.
So the local loop replaces it:

```bash
npm run dev                             # all three of the above, then serves them on :8080
npm test                                # errors, layout, identifiers, llm.txt, scenarios
```

`npm run dev` runs the stub, the real publisher and the build in the order they have to happen —
the bundle bakes in its data origin, so the port has to be decided first. The pieces separately:

```bash
node scripts/looker-stub.mjs &          # Looker API 4.0 on :8200
python3 scripts/local-publish.py        # the real publisher, S3 and Secrets Manager faked
npm run build                           # DATA_ORIGIN=http://localhost:8080
```

`npm test` rebuilds `dist/` for its own port, so stop `npm run dev` before running it and start it
again afterwards. Nothing errors if you do not — the page just quietly fetches from a port
nothing is listening on.

`local-publish.py` runs `publisher/app.py` unmodified — real HTTP, the real mapping, the real
checks — and writes the payload to `dist/v1/data/` where the object would land. The two boto3
call sites are the only things replaced.

The stub is built to lie on request, because a stub that only serves good data proves the happy
path and the happy path was never the risk. Each scenario should make the publisher refuse:

```bash
node scripts/looker-stub.mjs --scenario=list
node scripts/looker-stub.mjs --scenario=small-cell
```

| Scenario                  | Reproduces                                                     |
| ------------------------- | -------------------------------------------------------------- |
| `error-as-200`            | Looker answering an error with HTTP 200 and an error object    |
| `formatted`               | `apply_formatting` left on, so counts arrive as `"1,263"`      |
| `explosion`               | an aggregate Look repointed at client level                    |
| `small-cell`              | a named category of 3                                          |
| `small-residual`          | a remainder of 2, a small cell wearing another label           |
| `no-reconcile`            | `HAVING count >= 5` dropping rows so the parts stop summing    |
| `unknown-field`           | the measures Look growing a column                             |
| `unknown-field-breakdown` | the same on a breakdown, where the measures check never runs   |
| `live-floor`              | a live queue of 42, under the population floor                 |
| `pii-in-label`            | an email address as a category label                           |
| `pii-in-segment`          | a telephone number as a flow segment, where the label is a key |

When a real instance exists, set `LOOKER_BASE_URL` and the `*_LOOK_ID` variables and nothing
else changes.

### Testing a real deployment

A deployed Lambda cannot reach a stub on your machine, so `--mock` deploys the fake Looker
_into the stack_ — a second function behind a Function URL that the publisher reads exactly as
it would read Looker:

```bash
npm run deploy -- --mock                                # valid data
npm run deploy -- --mock --scenario small-cell          # the publisher must refuse this
```

No Looker URL, no Look IDs, no secret to populate: the template substitutes the mock's own
Function URL and Look IDs, and seeds a throwaway credential. `MockLookerUrl` appears in the
stack outputs, and its presence is how you know a stack is **not** reading a real Looker.

The mock and `scripts/looker-stub.mjs` share `mock-looker/scenarios.mjs`. Two copies would mean
a passing local run said nothing about the deployed one.

> The Function URL is **unauthenticated**. Everything it serves is invented, but it is still a
> public endpoint. `MockLooker` defaults to `false` and a production stack should never set it.

The scenario is the point of deploying this. Set a hostile one, invoke, and watch the real
function refuse, write nothing, and raise `PublishFailed` on the real alarm:

```bash
aws lambda invoke --function-name <stack>-PublisherFunction-… \
  --payload '{"cadence":"quarterly"}' /dev/stdout
```

## Building the bundle

CodeBuild, so nobody needs node or credentials locally to change a widget. Locally if you want:

```bash
node embed/build.mjs --origin https://<distribution>
```
