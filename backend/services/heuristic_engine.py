# LLD v2 §7 — rule-based heuristic engine.
# Confidence is a static, human-authored value per rule row — never computed, averaged,
# or inferred at runtime by the LLM or by application logic. Do not add a formula for it.
from models.schemas import Patient, TreatmentPrediction
from services.embedding_service import build_profile_text
from services.gemini_service import generate_explanation


def treatment_conflicts_with_allergies(allergies: list[str], treatment_name: str) -> bool:
    """True if any of the patient's allergies conflicts with the given treatment.

    TODO(spec-gap): LLD §7 references `treatment_conflicts_with_allergies` but does not
    define the conflict mapping. A small explicit token map is used below; the LLM never
    decides a conflict — this is static data, like the rule table itself.
    """
    normalized_allergies = [a.lower() for a in (allergies or [])]
    conflict_terms = TREATMENT_ALLERGY_CONFLICTS.get(treatment_name, set())
    return any(term in allergy or any(term in allergy for term in conflict_terms)
               for allergy in normalized_allergies)


# Known-conflict tokens per treatment (static data, auditable — extend freely).
TREATMENT_ALLERGY_CONFLICTS = {
    "Metformin (first-line)": {"metformin", "sulfa", "sulfonylurea"},
}


# A small, explicit rule table. Every row is auditable — rule_id traces back
# to exactly why a set of bands was assigned. Extend this table freely; never
# let the LLM assign bands or confidence_score directly.
RULES = [
    {
        "rule_id": "diabetes_metformin_default",
        "condition": lambda p: p.is_diabetic,
        "treatment_name": "Metformin (first-line)",
        "risk_band": "low",
        "success_band": "high",
        "side_effect_band": "low",
        "improvement_band": "high",
        "confidence_score": 0.85,
    },
    {
        "rule_id": "diabetes_pregnant_flag",
        "condition": lambda p: p.is_diabetic and p.is_pregnant,
        "treatment_name": "Metformin (first-line)",
        "risk_band": "medium",       # overrides default — pregnancy changes the picture
        "success_band": "medium",
        "side_effect_band": "medium",
        "improvement_band": "medium",
        "confidence_score": 0.6,     # lower confidence — fewer safety data points modeled
    },
    {
        "rule_id": "diabetes_elevated_pulse_flag",
        "condition": lambda p: p.is_diabetic and p.pulse and p.pulse > 100,
        "treatment_name": "Metformin (first-line)",
        "risk_band": "medium",
        "success_band": "medium",
        "side_effect_band": "medium",
        "improvement_band": "medium",
        "confidence_score": 0.65,
    },
    {
        "rule_id": "allergy_conflict_check",
        # TODO(spec-gap): §7 shows `lambda p, treatment: ...` but evaluate() calls each
        # condition with the patient only. Resolved by binding this rule's own
        # treatment_name here.
        "condition": lambda p: treatment_conflicts_with_allergies(
            p.allergies, "Metformin (first-line)"
        ),
        "risk_band": "high",
        "success_band": "low",
        "side_effect_band": "high",
        "improvement_band": "low",
        "confidence_score": 0.9,     # allergy conflicts are the most certain signal available
    },
    # Add more rules per treatment/condition combination as the demo dataset grows.
    # Every new rule MUST set all five output fields explicitly — no defaults, no inheritance.
]


_BAND_RANK = {"low": 1, "medium": 2, "high": 3}


def deduplicate_keep_highest_risk(results: list[TreatmentPrediction]) -> list[TreatmentPrediction]:
    """When multiple matched rules share the same treatment_name, keep only the row with
    the highest risk_band (high > medium > low). Never average or blend bands/confidence."""
    by_treatment: dict[str, TreatmentPrediction] = {}
    for result in results:
        existing = by_treatment.get(result.treatment_name)
        if existing is None or _BAND_RANK[result.risk_band] > _BAND_RANK[existing.risk_band]:
            by_treatment[result.treatment_name] = result
    return list(by_treatment.values())


def evaluate(patient: Patient) -> list[TreatmentPrediction]:
    results = []
    profile_summary = build_profile_text(patient)
    for rule in RULES:
        if rule["condition"](patient):
            explanation = generate_explanation(
                profile_summary=profile_summary,
                treatment_name=rule["treatment_name"],
                rule_id=rule["rule_id"],
                risk_band=rule["risk_band"],
                success_band=rule["success_band"],
                side_effect_band=rule["side_effect_band"],
                improvement_band=rule["improvement_band"],
            )
            results.append(TreatmentPrediction(
                treatment_name=rule["treatment_name"],
                risk_band=rule["risk_band"],
                success_band=rule["success_band"],
                side_effect_band=rule["side_effect_band"],
                improvement_band=rule["improvement_band"],
                confidence_score=rule["confidence_score"],
                explanation=explanation,
                rule_id=rule["rule_id"],
            ))
    # If more than one rule matches the same treatment_name, keep the row with
    # the highest risk_band (most conservative), never average bands or scores.
    # Out of scope (HLD §0.2): ranking or comparing across DIFFERENT treatment_names.
    return deduplicate_keep_highest_risk(results)