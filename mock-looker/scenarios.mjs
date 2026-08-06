/* The rows a fake Looker serves, and the ways it lies.
 *
 * One module, imported by both the local stub (`scripts/looker-stub.mjs`) and the deployed mock
 * (`mock-looker/app.mjs`). They must not drift: the whole point of the deployed one is to
 * rehearse in AWS what the local one proves on a laptop, and two copies of this data would make
 * a passing local run say nothing about the deployed one.
 *
 * Every figure here is invented. It is shaped like a Clarity HMIS aggregate and matches no
 * real person, place or period.
 */

// Look IDs this answers to. Anything else gets Looker's own not-found shape, so a wrong
// *_LOOK_ID environment variable fails the way it would against a real instance.
export const LOOKS = {
  1001: "measures",
  1002: "raceEthnicity",
  1003: "shelterStatus",
  1004: "county",
  2001: "live",
  2002: "weekly",
  2003: "waitBands",
  3001: "pitCount",
  3002: "newlyHomeless",
  3003: "flows",
  3004: "comparisons",
  3005: "rates",
};

const AS_OF = "2026-03-31T23:59:59Z";

const F = {
  asOf: "hmis_active.as_of_date",
  active: "hmis_active.persons_active",
  family: "hmis_active.persons_in_family_households",
  youth: "hmis_active.persons_in_youth_households",
  households: "hmis_active.family_households",
  race: "hmis_active.race_ethnicity",
  shelter: "hmis_active.shelter_status",
  county: "hmis_active.county",
  liveAsOf: "cq_overview.as_of",
  queue: "cq_overview.clients_on_queue",
  veterans: "cq_overview.veterans",
  chronic: "cq_overview.chronically_homeless",
  cqYouth: "cq_overview.unaccompanied_youth",
  parenting: "cq_overview.parenting_youth_households",
  older: "cq_overview.older_adults_55_61",
  seniors: "cq_overview.seniors_62_plus",
  band: "cq_overview.wait_band",
  clients: "cq_overview.clients",
};

/* A duplicate key here is silent — the later one wins and a Look starts emitting a field from
   another model. That is what happened when the queue's `youth` overwrote the quarterly one,
   and only the publisher's allowlist caught it. Cheap to make loud instead. */
{
  const names = Object.values(F);
  if (new Set(names).size !== names.length) {
    throw new Error("mock-looker/scenarios.mjs: duplicate LookML field in F");
  }
}

const measures = () => [
  {
    [F.asOf]: AS_OF,
    [F.active]: 1263,
    [F.family]: 197,
    [F.youth]: 135,
    [F.households]: 59,
  },
];

const race = () => [
  { [F.race]: "White", [F.active]: 664 },
  { [F.race]: "Black or African American", [F.active]: 401 },
  { [F.race]: "Multi-racial", [F.active]: 99 },
  { [F.race]: "All other categories", [F.active]: 99 },
];

const shelter = () => [
  { [F.shelter]: "Emergency shelter", [F.active]: 612 },
  { [F.shelter]: "Transitional housing", [F.active]: 288 },
  { [F.shelter]: "Unsheltered", [F.active]: 301 },
  { [F.shelter]: "Other or unknown", [F.active]: 62 },
];

/* Already folded, the way a derived table is supposed to hand it over: the named counties are
   all well above MIN_CELL and everything below it has been collapsed into the residual. */
const county = () => [
  { [F.county]: "Sedgwick", [F.active]: 1102 },
  { [F.county]: "Butler", [F.active]: 61 },
  { [F.county]: "Harvey", [F.active]: 38 },
  { [F.county]: "Reno", [F.active]: 27 },
  { [F.county]: "Sumner", [F.active]: 19 },
  { [F.county]: "All other counties", [F.active]: 16 },
];

const live = () => [{ [F.liveAsOf]: AS_OF, [F.queue]: 1308 }];

/* The queue's subgroups, on a weekly clock. They overlap — a veteran may also be chronically
   homeless — so they do not sum to the queue and must never be drawn as parts of a whole. */
const weekly = () => [
  {
    [F.liveAsOf]: AS_OF,
    [F.queue]: 1301,
    [F.veterans]: 28,
    [F.chronic]: 532,
    [F.cqYouth]: 71,
    [F.parenting]: 6,
    [F.older]: 181,
    [F.seniors]: 137,
  },
];

/* How long people have been waiting, as bands rather than an average. Sums to the weekly
   snapshot, which is what gives the reconciliation check something to hold on to. */
const waitBands = () => [
  { [F.band]: "Under 30 days", [F.clients]: 214 },
  { [F.band]: "30 to 89 days", [F.clients]: 268 },
  { [F.band]: "90 to 179 days", [F.clients]: 241 },
  { [F.band]: "180 to 364 days", [F.clients]: 166 },
  { [F.band]: "A year or more", [F.clients]: 412 },
];

/* ---- annual ----------------------------------------------------------------------------
 *
 * One Look per block, discriminated the same way the breakdowns are. The figures are invented
 * but internally consistent: PIT parts sum to their totals, and the flows are close enough to
 * balanced that the widget's callout says something worth reading either way. */
const A = {
  asOf: "hmis_annual.as_of_date",
  year: "hmis_annual.year",
  pit: "hmis_annual.pit_total",
  sheltered: "hmis_annual.pit_sheltered",
  unsheltered: "hmis_annual.pit_unsheltered",
  newly: "hmis_annual.newly_homeless",
  segment: "hmis_annual.segment",
  inn: "hmis_annual.became_homeless",
  out: "hmis_annual.housed_or_exited",
  income: "hmis_annual.median_income",
  alice: "hmis_annual.alice_budget",
  daysLocal: "hmis_annual.days_local",
  daysNational: "hmis_annual.days_national",
  hereLabel: "hmis_annual.here_label",
  thereLabel: "hmis_annual.there_label",
  percent: "hmis_annual.percent",
  households: "hmis_annual.households",
};
const ANNUAL_AS_OF = "2026-01-29T23:59:59Z";

const pitCount = () =>
  [
    ["2022", 512, 178],
    ["2023", 548, 201],
    ["2024", 574, 233],
    ["2025", 601, 244],
    ["2026", 623, 236],
  ].map(([year, sheltered, unsheltered]) => ({
    [A.asOf]: ANNUAL_AS_OF,
    [A.year]: year,
    [A.sheltered]: sheltered,
    [A.unsheltered]: unsheltered,
    [A.pit]: sheltered + unsheltered,
  }));

const newlyHomeless = () =>
  [
    ["2022", 812],
    ["2023", 877],
    ["2024", 934],
    ["2025", 902],
    ["2026", 948],
  ].map(([year, value]) => ({
    [A.asOf]: ANNUAL_AS_OF,
    [A.year]: year,
    [A.newly]: value,
  }));

const flows = () => [
  { [A.asOf]: ANNUAL_AS_OF, [A.segment]: "all", [A.inn]: 948, [A.out]: 861 },
  {
    [A.asOf]: ANNUAL_AS_OF,
    [A.segment]: "families",
    [A.inn]: 214,
    [A.out]: 233,
  },
  {
    [A.asOf]: ANNUAL_AS_OF,
    [A.segment]: "veterans",
    [A.inn]: 197,
    [A.out]: 205,
  },
];

const comparisons = () => [
  {
    [A.asOf]: ANNUAL_AS_OF,
    [A.income]: 38400,
    [A.alice]: 52700,
    [A.hereLabel]: "Median household income",
    [A.thereLabel]: "ALICE survival budget",
  },
  {
    [A.asOf]: ANNUAL_AS_OF,
    [A.daysLocal]: 51,
    [A.daysNational]: 141,
    [A.hereLabel]: "Sedgwick County",
    [A.thereLabel]: "National median",
  },
];

const rates = () => [
  { [A.asOf]: ANNUAL_AS_OF, [A.percent]: 87.4, [A.households]: 612 },
];

const VALID = {
  measures,
  raceEthnicity: race,
  shelterStatus: shelter,
  county,
  live,
  weekly,
  waitBands,
  pitCount,
  newlyHomeless,
  flows,
  comparisons,
  rates,
};

/* Each scenario returns rows for one look, or undefined to fall through to the valid set.
   A stub that only serves good data proves the happy path, and the happy path was never the
   risk — every one of these should make the publisher refuse. */
export const SCENARIOS = {
  valid: {
    why: "everything passes; the publisher writes both files",
    rows: () => undefined,
  },

  "error-as-200": {
    why: "Looker answers errors with HTTP 200 and an error object, not a 4xx",
    rows: (look) =>
      look === "measures"
        ? {
            message: "Not found",
            documentation_url: "https://cloud.google.com/looker/docs",
          }
        : undefined,
  },

  formatted: {
    why: 'apply_formatting left on, so counts arrive as "1,263" strings',
    rows: (look) =>
      look === "measures"
        ? [
            {
              [F.asOf]: AS_OF,
              [F.active]: "1,263",
              [F.family]: "197",
              [F.youth]: "135",
              [F.households]: "59",
            },
          ]
        : undefined,
  },

  explosion: {
    why: "an aggregate Look repointed at client level, caught by the limit tripwire",
    rows: (look) =>
      look === "measures"
        ? Array.from({ length: 500 }, (_, i) => ({
            [F.asOf]: AS_OF,
            [F.active]: 1,
            "hmis_active.client_id": `C${1000 + i}`,
          }))
        : undefined,
  },

  "small-cell": {
    why: "a named category of 3 people; MIN_CELL is 5",
    rows: (look) =>
      look === "shelterStatus"
        ? [
            { [F.shelter]: "Emergency shelter", [F.active]: 612 },
            { [F.shelter]: "Transitional housing", [F.active]: 288 },
            { [F.shelter]: "Unsheltered", [F.active]: 301 },
            { [F.shelter]: "Safe Haven", [F.active]: 3 },
            { [F.shelter]: "Other or unknown", [F.active]: 59 },
          ]
        : undefined,
  },

  "county-singletons": {
    why: "nine counties holding exactly one person each — the defect this project started from",
    rows: (look) =>
      look === "county"
        ? [
            { [F.county]: "Sedgwick", [F.active]: 1102 },
            { [F.county]: "Butler", [F.active]: 61 },
            { [F.county]: "Harvey", [F.active]: 38 },
            { [F.county]: "Reno", [F.active]: 27 },
            { [F.county]: "Sumner", [F.active]: 19 },
            ...[
              "Cowley",
              "Kingman",
              "Marion",
              "McPherson",
              "Pratt",
              "Rice",
              "Sedgwick North",
              "Stafford",
              "Barton",
            ].map((name) => ({ [F.county]: name, [F.active]: 1 })),
            { [F.county]: "All other counties", [F.active]: 7 },
          ]
        : undefined,
  },

  "small-residual": {
    why: "categories all fine but the remainder is 2, a small cell wearing another label",
    rows: (look) =>
      look === "raceEthnicity"
        ? [
            { [F.race]: "White", [F.active]: 664 },
            { [F.race]: "Black or African American", [F.active]: 401 },
            { [F.race]: "Multi-racial", [F.active]: 196 },
            { [F.race]: "All other categories", [F.active]: 2 },
          ]
        : undefined,
  },

  "no-reconcile": {
    why: "HAVING count >= 5 in the derived table: small rows dropped, so the parts stop summing",
    rows: (look) =>
      look === "raceEthnicity"
        ? [
            { [F.race]: "White", [F.active]: 664 },
            { [F.race]: "Black or African American", [F.active]: 401 },
            { [F.race]: "Multi-racial", [F.active]: 99 },
          ]
        : undefined,
  },

  "unknown-field": {
    why: "the measures Look grew a column, which is how a client identifier arrives",
    rows: (look) =>
      look === "measures"
        ? [{ ...measures()[0], "hmis_active.first_name": "REDACTED" }]
        : undefined,
  },

  // Its own scenario rather than a second look inside the one above, because the measures check
  // fires first and would mask this entirely — the breakdown allowlist would then be untested
  // while appearing to be covered.
  "unknown-field-breakdown": {
    why: "the same, on a breakdown Look, where the measures check never runs",
    rows: (look) =>
      look === "raceEthnicity"
        ? race().map((r) => ({ ...r, "hmis_active.client_id": "C1001" }))
        : undefined,
  },

  "annual-small-cell": {
    why: "a PIT year with 3 unsheltered people; the small-cell rule reaches series too",
    rows: (look) =>
      look === "pitCount"
        ? pitCount().map((r, i) =>
            i === 0
              ? { ...r, [A.unsheltered]: 3, [A.pit]: r[A.sheltered] + 3 }
              : r,
          )
        : undefined,
  },

  "annual-parts-mismatch": {
    why: "a stacked series whose parts do not sum to the total printed above the bar",
    rows: (look) =>
      look === "pitCount"
        ? pitCount().map((r, i) =>
            i === 0 ? { ...r, [A.pit]: r[A.pit] + 40 } : r,
          )
        : undefined,
  },

  "annual-thin-rate": {
    why: "87% of 4 households; every possible percentage maps back to an exact count",
    rows: (look) =>
      look === "rates"
        ? [{ [A.asOf]: ANNUAL_AS_OF, [A.percent]: 87.4, [A.households]: 4 }]
        : undefined,
  },

  "thin-subgroup": {
    why: "three parenting youth households; a subgroup measure is a count of people too",
    rows: (look) =>
      look === "weekly" ? [{ ...weekly()[0], [F.parenting]: 3 }] : undefined,
  },

  "band-singleton": {
    why: "a wait band holding two people, which is a small cell like any other",
    rows: (look) =>
      look === "waitBands"
        ? [
            { [F.band]: "Under 30 days", [F.clients]: 214 },
            { [F.band]: "30 to 89 days", [F.clients]: 268 },
            { [F.band]: "90 to 179 days", [F.clients]: 241 },
            { [F.band]: "180 to 364 days", [F.clients]: 164 },
            { [F.band]: "Two years or more", [F.clients]: 2 },
            { [F.band]: "A year or more", [F.clients]: 412 },
          ]
        : undefined,
  },

  "live-floor": {
    why: "a live queue of 42; under 100 a change of one identifies somebody",
    rows: (look) =>
      look === "live" ? [{ [F.liveAsOf]: AS_OF, [F.queue]: 42 }] : undefined,
  },

  /* The as-of was the one Looker string the identifier scan skipped, and nothing checked it was
     a timestamp — so anything the column carried published unread, onto the period line of a
     partner's page. It is validated for shape now, which is what makes the exemption safe. */
  "as-of-not-a-timestamp": {
    why: "the as-of column carrying an identifier instead of an instant",
    rows: (look) =>
      look === "measures"
        ? [{ ...measures()[0], [F.asOf]: "intake.coordinator@example.invalid" }]
        : undefined,
  },

  "pii-in-label": {
    why: "an email address as a category label; the field name is allowlisted, the value was not",
    rows: (look) =>
      look === "raceEthnicity"
        ? [
            { [F.race]: "intake.coordinator@example.invalid", [F.active]: 664 },
            { [F.race]: "Black or African American", [F.active]: 401 },
            { [F.race]: "Multi-racial", [F.active]: 99 },
            { [F.race]: "All other categories", [F.active]: 99 },
          ]
        : undefined,
  },

  // A segment name becomes a key in the payload rather than a value, so it is reached by a
  // different branch of the scan. Covered separately because a check on values alone passes
  // every other identifier test in this file while leaving this one open.
  "pii-in-segment": {
    why: "a telephone number as a flow segment, where the label is a key and not a value",
    rows: (look) =>
      look === "flows"
        ? flows().map((r, i) =>
            i === 1 ? { ...r, [A.segment]: "(316) 555-0142" } : r,
          )
        : undefined,
  },
};

export const TOKEN = "stub-token";

export function rowsFor(scenario, look) {
  const override = SCENARIOS[scenario].rows(look);
  return override === undefined ? VALID[look]() : override;
}

/* The two endpoints the publisher uses, as a pure function of the request. Both callers are
   thin shells over this: the local stub wraps it in an http server, the deployed one in a
   Lambda handler, and neither decides anything on its own. */
export function respond({ method, path, query, headers, body }, scenario) {
  const auth = headers.authorization || headers.Authorization || "";

  if (method === "POST" && path === "/api/4.0/login") {
    const form = new URLSearchParams(body || "");
    // Presence only. This is a mock; refusing a blank credential is enough to catch a caller
    // that forgot to send one, and checking the value would mean storing a fake secret.
    if (!form.get("client_id") || !form.get("client_secret")) {
      return {
        status: 401,
        body: { message: "Invalid API credentials" },
        log: "login -> 401",
      };
    }
    return {
      status: 200,
      body: { access_token: TOKEN, token_type: "Bearer", expires_in: 3600 },
      log: `login -> ok (${form.get("client_id")})`,
    };
  }

  const match = path.match(/^\/api\/4\.0\/looks\/([^/]+)\/run\/json$/);
  if (method === "GET" && match) {
    if (auth !== `token ${TOKEN}`) {
      return {
        status: 401,
        body: { message: "Not authenticated" },
        log: `look ${match[1]} -> 401`,
      };
    }
    const look = LOOKS[match[1]];
    if (!look) {
      // Looker's own shape for this is HTTP 200 with an error object, which is the whole reason
      // looker.py inspects the body rather than trusting the status code.
      return {
        status: 200,
        body: { message: "Not found" },
        log: `look ${match[1]} -> unknown`,
      };
    }
    const rows = rowsFor(scenario, look);
    return {
      status: 200,
      body: rows,
      log: `look ${match[1]} (${look}) -> ${Array.isArray(rows) ? `${rows.length} rows` : "error object"} [${scenario}]`,
      query,
    };
  }

  return {
    status: 404,
    body: { message: "Not found" },
    log: `${method} ${path} -> 404`,
  };
}
