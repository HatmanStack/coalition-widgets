"""What may be published, and where each figure comes from.

One table. Adding a measure means adding a row here and nowhere else, and a figure with no row
cannot reach S3.

**The Look IDs and field names are placeholders.** Set the real ones as environment variables or
edit this table; nothing else in the publisher needs to change.
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


# cadence -> what that file carries
QUARTERLY = {
    "look": "QUARTERLY_LOOK_ID",
    "as_of_field": "hmis_active.as_of_date",
    "measures": (
        Measure("activelyHomeless", "hmis_active.persons_active"),
        Measure("personsInFamilyHouseholds", "hmis_active.persons_in_family_households"),
        Measure("personsInYouthHouseholds", "hmis_active.persons_in_youth_households"),
        Measure("familyHouseholds", "hmis_active.family_households"),
    ),
}

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
)

LIVE = {
    "look": "LIVE_LOOK_ID",
    "as_of_field": "cq_overview.as_of",
    "measures": (Measure("queueTotal", "cq_overview.clients_on_queue"),),
}

RESIDUAL_LABELS = frozenset({"All other categories", "Other or unknown"})
