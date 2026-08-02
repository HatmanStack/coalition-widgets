# Coalition widgets

Looker to S3 to a script tag.

**Unaffiliated concept work.** Not produced, authorised or endorsed by United Way of the Plains
or the Coalition to End Homelessness.

```
Looker  →  Lambda  →  s3://…/v1/data/*.json  →  CloudFront  →  <script> on a partner page
                          ↑
                    CodeBuild builds the bundle and publishes it to the same bucket
```

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
{"client_id": "...", "client_secret": "..."}
```

The schedule ships `DISABLED`. Enable it once a run has been watched:

```bash
npm run deploy -- --yes   # after setting ScheduleState=ENABLED in template.yaml or on the CLI
aws lambda invoke --function-name <stack>-PublisherFunction-… --payload '{"cadence":"quarterly"}' /dev/stdout
```

## Embed

After a build, the tag is at `https://<distribution>/v1/manifest.json`:

```html
<script src="https://d111111abcdef8.cloudfront.net/v1/chc.a1b2c3d4.js"
        integrity="sha384-…" crossorigin="anonymous" defer
        data-widgets="hmis-snapshot"></script>
```

It renders where the tag sits. Several tags on a page cost one fetch and one poll timer.

| Attribute | Values | Default |
|---|---|---|
| `data-widgets` | comma list, in render order | required |
| `data-theme` | `auto` `light` `dark` | `auto`, measured from the page |
| `data-size` | `auto` `xs` `sm` `md` `lg` `xl` | `auto`, from container width |
| `data-years` | integer | the full published span |
| `data-segment` | `all` `veterans` | `all` |
| `data-table` | `true` `false` | `true` |
| `data-target` | CSS selector | where the tag sits |

### Widgets

| Name | Reads | Shows |
|---|---|---|
| `hmis-snapshot` | quarterly | the whole quarterly dashboard in one card |
| `active-count` | quarterly | people actively experiencing homelessness |
| `queue-total` | live | people waiting for housing right now |
| `race-ethnicity` | quarterly | sorted bars |
| `shelter-status` | quarterly | 100% stacked bar |
| `pit-trend` | annual | the January census, sheltered against unsheltered |
| `newly-homeless` | annual | households becoming homeless each year |
| `inflow-outflow` | annual | became homeless against housed or exited |
| `alice-gap` | annual | survival budget against median income |
| `length-of-stay` | annual | days homeless, local against national |
| `retention` | annual | still housed two years on |

Theme is measured rather than declared: the bundle walks up from its host, finds the first
background with any opacity, and picks from its luminance. A partner with a dark page and a
system set to light gets a dark widget, which `prefers-color-scheme` would get wrong.

Every breakpoint is a container query. A widget in a 320px sidebar on a 1440px desktop is narrow,
and a media query would say it is wide.

## What the Lambda refuses to publish

Nothing is written unless all of it passes:

- a named category below 5 people, or a remainder below 5, which is a small cell wearing a
  different label
- categories that do not sum to the universe they are stated against
- more than one measure on the live file, since two fast measures let an observer
  cross-difference successive snapshots
- a live measure under 100 people, where a change of one identifies somebody

A failure writes nothing, leaves the previous file serving, and emits `PublishFailed`.

## Building the bundle

CodeBuild, so nobody needs node or credentials locally to change a widget. Locally if you want:

```bash
node embed/build.mjs --origin https://<distribution>
```
