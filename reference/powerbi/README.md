# Power BI rebuild spec

For the option where the report stays in Power BI. Everything here is model and report
work; none of it depends on the static site in the parent directory.

`theme.json` is importable as-is: **View → Themes → Browse for themes**. It carries the
same validated palette the static build uses, sets titles left-aligned rather than
centered and underlined, turns off drop shadows and visual borders, and puts gridlines on
a hairline. Import it before laying anything out so the visuals inherit it.

One constraint to expect: the Power BI service renders from a fixed font list. Antonio and
Palanquin are not on it, so the report is Segoe UI regardless. That seam is invisible if
you pull data and render on the page, and visible if you embed the report in the page.

## Page setup

Two pages, because publish-to-web always renders the desktop canvas and ignores Power BI's
phone layout.

| Page | Size | Purpose |
|---|---|---|
| `Dashboard` | 1280 × 720 (16:9) | Desktop. Format → Canvas settings → Type: 16:9 |
| `Dashboard (narrow)` | 480 × 1400 | Phones. Canvas settings → Type: Custom |

Serve both from one publish-to-web link using `&pageName=ReportSection<id>` on the embed
URL, and let a CSS media query decide which iframe renders. Get the section id from the
report URL when that page is selected in the service.

**Verify `pageName` works on your report before building the second page.** If it does not
hold for publish-to-web on your tenant, the fallback is `&pageView=fitToWidth` on a single
16:9 canvas wrapped in an aspect-ratio box, which fits but scales text to roughly 30% at
390px.

## Visuals

Desktop canvas, top to bottom:

1. **Text box** — title, plus a right-aligned as-of line. The current report carries no
   as-of date anywhere inside it, so a shared link is undated.
2. **Four cards** — persons (1,263), persons in family households (197), persons in youth
   households (135), family households (59).
3. **Clustered bar chart** — race and ethnicity. Sorted descending, single series color
   (slot 1), data labels on. Replaces an eight-slice pie in eight shades of one blue.
4. **100% stacked bar** — shelter status. Three hues plus grey for unknown.
5. **Clustered column chart** — persons by quarter. Requires a date dimension the current
   model may not have.
6. **Text box** — the counting definition.

Narrow canvas: the same visuals in one column, cards two across.

## Measures to fix first

These are the reason the rebuild exists. All five are model problems, and they need fixing
whichever front end you choose.

| Measure | Symptom | What to check |
|---|---|---|
| Households actively homeless | 1,478 against 1,263 people | Date filter and the grain it counts at |
| Youth-led households | 6 households holding 135 people | Same |
| Length of stay | Resolves to ~2,905, not 1,263 | Visual-level vs page-level filters |
| Jail/prison release | Resolves to ~5,020 | Same |
| County of origin | Nine counties at n=1, published anonymously | Suppression, plus Edit interactions |

Three of these five are likely one fix: a visual filtered to a different population than
the page. Check page-level against visual-level filters on those three before touching
anything else.

## Small-cell suppression in DAX

Suppression is a measure, not a setting. Wrap the count so it returns BLANK below the
threshold and the visual drops the category rather than drawing it.

```dax
Min Cell = 5

Clients Shown =
VAR _n = DISTINCTCOUNT ( Clients[ClientID] )
RETURN
    IF ( _n >= [Min Cell], _n )
```

To keep the suppressed people visible in the total rather than silently lost:

```dax
Clients Suppressed =
VAR _shown =
    SUMX ( VALUES ( Clients[County] ), [Clients Shown] )
RETURN
    DISTINCTCOUNT ( Clients[ClientID] ) - _shown
```

Surface that second measure as a card reading "N people from counties too small to name."

**Also turn off cross-filtering** on any visual that can drive another below the threshold:
Format → Edit interactions → None. Power BI enables it by default, and suppression at rest
does not survive a user clicking a small slice on a neighbouring visual.

Note the difference from the static build: there, suppression is a function every value
passes through before it can reach the DOM, so a new chart inherits it automatically. Here
it is a measure someone can edit, and a visual added later does not inherit it. That is a
process control rather than a structural one, and it is worth writing into whatever
runbook governs the report.

## Publishing

File → Embed report → Publish to web (public). Understand what that means: the link is the
credential, it is anonymous, shareable and cacheable, and it refreshes on a cache of up to
about an hour. For HMIS-derived figures that is a governance decision rather than a
technical one. The authenticated alternatives are Embedded or Fabric capacity, both real
recurring cost.
