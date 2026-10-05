// Training identifiers and vocabularies pinned to the upstream registry; no clinical examples or weights.
import {freeze} from './integrity.mjs';
export const CLINICAL_CONTRACT = freeze({
  "schemaVersion": "clinical-evidence/0.1",
  "registryHash": "80f255076cde0237c3f176b45545807bb237cbc57af1d983c6550a6d6816f547",
  "repository": "na399/clinical-evidence",
  "revision": "f6cadc1bb52bc8475f33d9bb0e0c072427954d92",
  "semanticSchemaVersion": "teacher-schema/0.2",
  "families": {
    "condition_occurrence": {
      "anchor": "condition",
      "entityType": "clinical_condition",
      "fields": {
        "condition": {
          "kind": "literal",
          "dtype": "str"
        },
        "assertion": {
          "kind": "choice",
          "values": [
            "affirmed",
            "negated",
            "uncertain",
            "hypothetical",
            "ruled_out"
          ],
          "exportValues": [
            "affirmed",
            "negated",
            "uncertain",
            "hypothetical",
            "ruled_out",
            "unspecified",
            "not_applicable"
          ]
        },
        "time_frame": {
          "kind": "choice",
          "values": [
            "current",
            "recent",
            "historical",
            "future"
          ],
          "exportValues": [
            "current",
            "recent",
            "historical",
            "future",
            "unspecified",
            "not_applicable"
          ]
        },
        "time_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "experiencer": {
          "kind": "choice",
          "values": [
            "patient",
            "family",
            "other"
          ],
          "exportValues": [
            "patient",
            "family",
            "other",
            "unspecified",
            "not_applicable"
          ]
        },
        "reporter_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "severity_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "severity": {
          "kind": "choice",
          "values": [
            "mild",
            "moderate",
            "severe",
            "advanced",
            "end_stage"
          ],
          "exportValues": [
            "mild",
            "moderate",
            "severe",
            "advanced",
            "end_stage",
            "unspecified",
            "not_applicable"
          ]
        },
        "stage_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "chronicity": {
          "kind": "choice",
          "values": [
            "acute",
            "chronic"
          ],
          "exportValues": [
            "acute",
            "chronic",
            "unspecified",
            "not_applicable"
          ]
        },
        "trajectory": {
          "kind": "choice",
          "values": [
            "new",
            "stable",
            "worsening",
            "improving",
            "resolved",
            "recurrent"
          ],
          "exportValues": [
            "new",
            "stable",
            "worsening",
            "improving",
            "resolved",
            "recurrent",
            "unspecified",
            "not_applicable"
          ]
        },
        "site_text": {
          "kind": "literal",
          "dtype": "list"
        }
      }
    },
    "measurement_occurrence": {
      "anchor": "measure",
      "entityType": "clinical_measure",
      "fields": {
        "measure": {
          "kind": "literal",
          "dtype": "str"
        },
        "value_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "reference_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "interpretation_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "assertion": {
          "kind": "choice",
          "values": [
            "affirmed",
            "negated",
            "uncertain",
            "hypothetical",
            "ruled_out"
          ],
          "exportValues": [
            "affirmed",
            "negated",
            "uncertain",
            "hypothetical",
            "ruled_out",
            "unspecified",
            "not_applicable"
          ]
        },
        "time_frame": {
          "kind": "choice",
          "values": [
            "current",
            "recent",
            "historical",
            "future"
          ],
          "exportValues": [
            "current",
            "recent",
            "historical",
            "future",
            "unspecified",
            "not_applicable"
          ]
        },
        "time_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "experiencer": {
          "kind": "choice",
          "values": [
            "patient",
            "family",
            "other"
          ],
          "exportValues": [
            "patient",
            "family",
            "other",
            "unspecified",
            "not_applicable"
          ]
        },
        "reporter_text": {
          "kind": "literal",
          "dtype": "str"
        }
      }
    },
    "treatment_occurrence": {
      "anchor": "treatment",
      "entityType": "clinical_treatment",
      "fields": {
        "treatment": {
          "kind": "literal",
          "dtype": "str"
        },
        "mention_context": {
          "kind": "choice",
          "values": [
            "medication_list",
            "prescription",
            "administration",
            "allergy",
            "discussion",
            "procedure",
            "other"
          ],
          "exportValues": [
            "medication_list",
            "prescription",
            "administration",
            "allergy",
            "discussion",
            "procedure",
            "other",
            "unspecified",
            "not_applicable"
          ]
        },
        "status": {
          "kind": "choice",
          "values": [
            "ordered",
            "prescribed",
            "administered",
            "continued",
            "held",
            "stopped",
            "refused",
            "planned",
            "considered",
            "not_candidate"
          ],
          "exportValues": [
            "ordered",
            "prescribed",
            "administered",
            "continued",
            "held",
            "stopped",
            "refused",
            "planned",
            "considered",
            "not_candidate",
            "unspecified",
            "not_applicable"
          ]
        },
        "indication_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "dose_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "route_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "schedule_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "response_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "assertion": {
          "kind": "choice",
          "values": [
            "affirmed",
            "negated",
            "uncertain",
            "hypothetical",
            "ruled_out"
          ],
          "exportValues": [
            "affirmed",
            "negated",
            "uncertain",
            "hypothetical",
            "ruled_out",
            "unspecified",
            "not_applicable"
          ]
        },
        "time_frame": {
          "kind": "choice",
          "values": [
            "current",
            "recent",
            "historical",
            "future"
          ],
          "exportValues": [
            "current",
            "recent",
            "historical",
            "future",
            "unspecified",
            "not_applicable"
          ]
        },
        "time_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "experiencer": {
          "kind": "choice",
          "values": [
            "patient",
            "family",
            "other"
          ],
          "exportValues": [
            "patient",
            "family",
            "other",
            "unspecified",
            "not_applicable"
          ]
        },
        "reporter_text": {
          "kind": "literal",
          "dtype": "str"
        }
      }
    },
    "event_occurrence": {
      "anchor": "event",
      "entityType": "clinical_event",
      "fields": {
        "event": {
          "kind": "literal",
          "dtype": "str"
        },
        "form": {
          "kind": "choice",
          "values": [
            "action",
            "experience",
            "state"
          ],
          "exportValues": [
            "action",
            "experience",
            "state",
            "unspecified",
            "not_applicable"
          ]
        },
        "status": {
          "kind": "choice",
          "values": [
            "occurred",
            "ongoing",
            "planned",
            "threatened",
            "aborted",
            "interrupted"
          ],
          "exportValues": [
            "occurred",
            "ongoing",
            "planned",
            "threatened",
            "aborted",
            "interrupted",
            "unspecified",
            "not_applicable"
          ]
        },
        "intent": {
          "kind": "choice",
          "values": [
            "suicidal",
            "nonsuicidal_self_harm",
            "accidental",
            "therapeutic",
            "assault"
          ],
          "exportValues": [
            "suicidal",
            "nonsuicidal_self_harm",
            "accidental",
            "therapeutic",
            "assault",
            "unspecified",
            "not_applicable"
          ]
        },
        "mechanism_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "agent_text": {
          "kind": "literal",
          "dtype": "list"
        },
        "frequency_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "frequency": {
          "kind": "choice",
          "values": [
            "single",
            "intermittent",
            "recurrent",
            "persistent"
          ],
          "exportValues": [
            "single",
            "intermittent",
            "recurrent",
            "persistent",
            "unspecified",
            "not_applicable"
          ]
        },
        "duration_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "trigger_text": {
          "kind": "literal",
          "dtype": "list"
        },
        "target_text": {
          "kind": "literal",
          "dtype": "list"
        },
        "impact_text": {
          "kind": "literal",
          "dtype": "list"
        },
        "outcome_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "severity_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "severity": {
          "kind": "choice",
          "values": [
            "mild",
            "moderate",
            "severe",
            "advanced",
            "end_stage"
          ],
          "exportValues": [
            "mild",
            "moderate",
            "severe",
            "advanced",
            "end_stage",
            "unspecified",
            "not_applicable"
          ]
        },
        "assertion": {
          "kind": "choice",
          "values": [
            "affirmed",
            "negated",
            "uncertain",
            "hypothetical",
            "ruled_out"
          ],
          "exportValues": [
            "affirmed",
            "negated",
            "uncertain",
            "hypothetical",
            "ruled_out",
            "unspecified",
            "not_applicable"
          ]
        },
        "time_frame": {
          "kind": "choice",
          "values": [
            "current",
            "recent",
            "historical",
            "future"
          ],
          "exportValues": [
            "current",
            "recent",
            "historical",
            "future",
            "unspecified",
            "not_applicable"
          ]
        },
        "time_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "experiencer": {
          "kind": "choice",
          "values": [
            "patient",
            "family",
            "other"
          ],
          "exportValues": [
            "patient",
            "family",
            "other",
            "unspecified",
            "not_applicable"
          ]
        },
        "reporter_text": {
          "kind": "literal",
          "dtype": "str"
        }
      }
    },
    "function_occurrence": {
      "anchor": "activity",
      "entityType": "functional_activity",
      "fields": {
        "activity": {
          "kind": "literal",
          "dtype": "str"
        },
        "ability": {
          "kind": "choice",
          "values": [
            "independent",
            "difficulty",
            "unable"
          ],
          "exportValues": [
            "independent",
            "difficulty",
            "unable",
            "unspecified",
            "not_applicable"
          ]
        },
        "assistance_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "assistance": {
          "kind": "choice",
          "values": [
            "none",
            "setup",
            "supervision",
            "minimal",
            "moderate",
            "maximal",
            "total"
          ],
          "exportValues": [
            "none",
            "setup",
            "supervision",
            "minimal",
            "moderate",
            "maximal",
            "total",
            "unspecified",
            "not_applicable"
          ]
        },
        "device_text": {
          "kind": "literal",
          "dtype": "list"
        },
        "trajectory": {
          "kind": "choice",
          "values": [
            "new",
            "stable",
            "worsening",
            "improving",
            "resolved",
            "recurrent"
          ],
          "exportValues": [
            "new",
            "stable",
            "worsening",
            "improving",
            "resolved",
            "recurrent",
            "unspecified",
            "not_applicable"
          ]
        },
        "assertion": {
          "kind": "choice",
          "values": [
            "affirmed",
            "negated",
            "uncertain",
            "hypothetical",
            "ruled_out"
          ],
          "exportValues": [
            "affirmed",
            "negated",
            "uncertain",
            "hypothetical",
            "ruled_out",
            "unspecified",
            "not_applicable"
          ]
        },
        "time_frame": {
          "kind": "choice",
          "values": [
            "current",
            "recent",
            "historical",
            "future"
          ],
          "exportValues": [
            "current",
            "recent",
            "historical",
            "future",
            "unspecified",
            "not_applicable"
          ]
        },
        "time_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "experiencer": {
          "kind": "choice",
          "values": [
            "patient",
            "family",
            "other"
          ],
          "exportValues": [
            "patient",
            "family",
            "other",
            "unspecified",
            "not_applicable"
          ]
        },
        "reporter_text": {
          "kind": "literal",
          "dtype": "str"
        }
      }
    },
    "care_context_occurrence": {
      "anchor": "care_context",
      "entityType": "care_context",
      "fields": {
        "care_context": {
          "kind": "literal",
          "dtype": "str"
        },
        "context_type": {
          "kind": "choice",
          "values": [
            "hospice",
            "palliative_care",
            "skilled_nursing",
            "long_term_care",
            "assisted_living",
            "home_health",
            "caregiver_support"
          ],
          "exportValues": [
            "hospice",
            "palliative_care",
            "skilled_nursing",
            "long_term_care",
            "assisted_living",
            "home_health",
            "caregiver_support",
            "unspecified",
            "not_applicable"
          ]
        },
        "status": {
          "kind": "choice",
          "values": [
            "active",
            "planned",
            "considered",
            "declined",
            "discontinued"
          ],
          "exportValues": [
            "active",
            "planned",
            "considered",
            "declined",
            "discontinued",
            "unspecified",
            "not_applicable"
          ]
        },
        "reason_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "assertion": {
          "kind": "choice",
          "values": [
            "affirmed",
            "negated",
            "uncertain",
            "hypothetical",
            "ruled_out"
          ],
          "exportValues": [
            "affirmed",
            "negated",
            "uncertain",
            "hypothetical",
            "ruled_out",
            "unspecified",
            "not_applicable"
          ]
        },
        "time_frame": {
          "kind": "choice",
          "values": [
            "current",
            "recent",
            "historical",
            "future"
          ],
          "exportValues": [
            "current",
            "recent",
            "historical",
            "future",
            "unspecified",
            "not_applicable"
          ]
        },
        "time_text": {
          "kind": "literal",
          "dtype": "str"
        },
        "experiencer": {
          "kind": "choice",
          "values": [
            "patient",
            "family",
            "other"
          ],
          "exportValues": [
            "patient",
            "family",
            "other",
            "unspecified",
            "not_applicable"
          ]
        },
        "reporter_text": {
          "kind": "literal",
          "dtype": "str"
        }
      }
    }
  }
});
