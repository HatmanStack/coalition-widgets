"""What may be published, and where each figure comes from.

One registry. Adding a measure means adding an entry here and nowhere else, and a figure with no
entry cannot reach S3.

(Deliberately not called a table, and nothing here is a "row": in this publisher a row is a row
returned by a Look, and `measures_from` and `breakdown_from` both take them by that name.
Overloading the word makes the mapping code ambiguous exactly where it needs to be read
carefully.)

**The Look IDs and field names are placeholders.** Set the real ones as environment variables or
edit the entries below; nothing else in the publisher needs to change.
"""

from dataclasses import dataclass

MIN_CELL = 5  # any named category below this must not be published


@dataclass(frozen=True)
class Measure:
    id: str
    field: str


@dataclass(frozen=True)
class Breakdown:
    id: str
    label_field: str
    value_field: str
    universe: str


# --- annual blocks ---------------------------------------------------------------------------
#
# The annual file carries four shapes the quarterly one does not: a series over years, the flow
# in and out, a comparison against somewhere else, and a rate. Each is one Look returning one
# row per item, discriminated by an id column, which is the same arrangement the breakdowns use.
#
# This shape is provisional and expected to move. The eventual source for several of these is a
# published PDF read by a model rather than a Look, and that path may produce something else.


@dataclass(frozen=True)
class Series:
    """A count per year. `parts` are stacked components that must sum to the total."""

    id: str
    label_field: str
    value_field: str
    parts: tuple[tuple[str, str], ...] = ()  # (payload key, LookML field)


@dataclass(frozen=True)
class Flow:
    """People entering and leaving homelessness in a period, per segment."""

    segment_field: str
    in_field: str
    out_field: str


@dataclass(frozen=True)
class Comparison:
    """Here against somewhere else. NOT a count of people — dollars, days — so the small-cell
    rule does not apply and `check` must not pretend it does."""

    id: str
    here_field: str
    there_field: str
    here_label_field: str
    there_label_field: str


@dataclass(frozen=True)
class Rate:
    """A proportion. `denominator_field` is required: a percentage over a handful of households
    is as disclosive as printing the households, and without the denominator nothing downstream
    can tell the difference between 87% of 900 and 87% of 8."""

    id: str
    percent_field: str
    denominator_field: str


BREAKDOWNS = (
    Breakdown(
        "raceEthnicity",
        "hmis_active.race_ethnicity",
        "hmis_active.persons_active",
        "activelyHomeless",
    ),
    Breakdown(
        "shelterStatus",
        "hmis_active.shelter_status",
        "hmis_active.persons_active",
        "activelyHomeless",
    ),
    # The county a person lived in BEFORE, not where they are. Everyone counted is in Sedgwick
    # County; this breaks that population down by where they came from.
    #
    # This is the breakdown most likely to arrive disclosive, and the reason the small-cell rule
    # exists at all: the published dashboard this project started from showed nine counties
    # holding exactly one person each, which in a rural county is a name. A long tail of ones and
    # twos is the normal shape of county data here, not an anomaly. Origin makes that worse, not
    # better — one person who left a small rural county for Sedgwick is more findable there than
    # a resident of it would be, because the county they left knows who went.
    #
    # So the derived table must fold everything under MIN_CELL into "All other counties" before
    # it reaches this publisher. `check` refuses the payload otherwise, and refusing is the
    # point — the fold belongs where somebody can review it, not in a mapper that quietly
    # rewrites what Looker said.
    Breakdown(
        "county",
        "hmis_active.county",
        "hmis_active.persons_active",
        "activelyHomeless",
    ),
)

QUARTERLY = {
    "look": "QUARTERLY_LOOK_ID",
    "as_of_field": "hmis_active.as_of_date",
    "measures": (
        Measure("activelyHomeless", "hmis_active.persons_active"),
        Measure(
            "personsInFamilyHouseholds", "hmis_active.persons_in_family_households"
        ),
        Measure("personsInYouthHouseholds", "hmis_active.persons_in_youth_households"),
        Measure("familyHouseholds", "hmis_active.family_households"),
    ),
    # Which breakdowns a cadence carries belongs to the cadence itself, rather than to a
    # `cadence != "live"` test in the publisher. That test reads as "everything except live has
    # these two", which is only true while there are exactly two cadences — the next one added
    # would silently inherit race and shelter status and go looking for their Look IDs.
    "breakdowns": BREAKDOWNS,
}

LIVE = {
    "look": "LIVE_LOOK_ID",
    "as_of_field": "cq_overview.as_of",
    "measures": (Measure("queueTotal", "cq_overview.clients_on_queue"),),
    "breakdowns": (),
}

# --- weekly: everything about the queue that is not the headline count ----------------------
#
# The queue's subgroups and how long people have been waiting, on a slow clock. Only the total
# moves live, which is what `check` enforces when it allows one measure on the live file: two
# fast figures let an observer watch the total drop by one and a subgroup drop by one in the
# same minute, and that is a person.
#
# The waits are BANDS, not an average.
#
# A mean published beside its denominator discloses individual tenures by arithmetic. With the
# queue size known — and it is, it is the headline of the same card — the sum of waiting time is
# mean x count, and the week-on-week difference is exactly the tenure that walked out of the
# door. One departure in a week and that number is that person's wait, to the day.
#
# Bands are counts, so they fall under the small-cell rule and the reconciliation check that
# already exist, and they say more: "412 people have waited more than a year" carries the point
# that an average hides.
WAIT_BANDS = Breakdown(
    "waitBands",
    "cq_overview.wait_band",
    "cq_overview.clients",
    "queueSnapshot",
)

WEEKLY = {
    "look": "WEEKLY_LOOK_ID",
    "as_of_field": "cq_overview.as_of",
    "measures": (
        # The queue size at THIS snapshot, so the bands have a denominator taken at the same
        # moment they were. Reconciling them against the live total would compare two different
        # instants and fail for a reason that has nothing to do with the data being wrong.
        Measure("queueSnapshot", "cq_overview.clients_on_queue"),
        Measure("veterans", "cq_overview.veterans"),
        Measure("chronicallyHomeless", "cq_overview.chronically_homeless"),
        Measure("unaccompaniedYouth", "cq_overview.unaccompanied_youth"),
        Measure("parentingYouthHouseholds", "cq_overview.parenting_youth_households"),
        Measure("olderAdults", "cq_overview.older_adults_55_61"),
        Measure("seniors", "cq_overview.seniors_62_plus"),
    ),
    "breakdowns": (WAIT_BANDS,),
}

RESIDUAL_LABELS = frozenset(
    {"All other categories", "Other or unknown", "All other counties"}
)

# Every cadence that may be published, and what produces it. The lookup used to be
# `LIVE if cadence == "live" else QUARTERLY`, whose bare `else` meant an unrecognised cadence ran
# the quarterly Looks and wrote them under that cadence's filename — quarterly figures stamped
# `"cadence": "annual"`, which every check passes, because the checks read values and the lie was
# in the label.
#
# A cadence absent from here cannot be published.
ANNUAL = {
    "look": "ANNUAL_LOOK_ID",
    "as_of_field": "hmis_annual.as_of_date",
    # The annual file carries no headline measures of its own; every figure on it belongs to one
    # of the blocks below. An empty tuple rather than a special case in the builder.
    "measures": (),
    "breakdowns": (),
    "series": (
        Series(
            "pitCount",
            "hmis_annual.year",
            "hmis_annual.pit_total",
            parts=(
                ("sheltered", "hmis_annual.pit_sheltered"),
                ("unsheltered", "hmis_annual.pit_unsheltered"),
            ),
        ),
        Series("newlyHomeless", "hmis_annual.year", "hmis_annual.newly_homeless"),
    ),
    "flows": Flow(
        "hmis_annual.segment",
        "hmis_annual.became_homeless",
        "hmis_annual.housed_or_exited",
    ),
    "comparisons": (
        Comparison(
            "aliceGap",
            "hmis_annual.median_income",
            "hmis_annual.alice_budget",
            "hmis_annual.here_label",
            "hmis_annual.there_label",
        ),
        Comparison(
            "lengthOfStay",
            "hmis_annual.days_local",
            "hmis_annual.days_national",
            "hmis_annual.here_label",
            "hmis_annual.there_label",
        ),
    ),
    "rates": (Rate("retention", "hmis_annual.percent", "hmis_annual.households"),),
}

CADENCES = {
    "quarterly": QUARTERLY,
    "live": LIVE,
    "weekly": WEEKLY,
    "annual": ANNUAL,
}
