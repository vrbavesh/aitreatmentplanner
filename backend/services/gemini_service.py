# LLD v2 §5 — Gemini client: single multimodal call (document image/PDF in,
# structured JSON out — OCR + extraction combined), plus treatment explanation text.
# No separate OCR provider/service anywhere in this system.
from google import genai
from google.genai import types

from config import GEMINI_API_KEY, LLM_MODEL_NAME


class GeminiProviderError(Exception):
    """Raised on any upstream Gemini API failure (mapped to HTTP 502)."""


_client = genai.Client(api_key=GEMINI_API_KEY)

# LLD v2 §5.1 — extraction prompt (blood report).
EXTRACTION_PROMPT_BLOOD_REPORT_SYSTEM = (
    "You are a medical document field extractor. You read the attached document "
    "image/PDF directly. You extract only explicitly stated values. You never infer, "
    "estimate, or calculate a value that is not directly present in the document. "
    "Respond with valid JSON only, no prose, no markdown fences."
)
EXTRACTION_PROMPT_BLOOD_REPORT_USER = """\
Extract the following fields from the attached lab report.
If a field is not explicitly present, return null for it. For each field also
return a confidence score between 0 and 1 reflecting how clearly it was stated.

Fields: hba1c, fasting_glucose, postprandial_glucose, date_of_test

Respond in this exact JSON shape:
{
  "fields": [
    {"field_name": "hba1c", "field_value": "<value or null>", "confidence": <0-1>},
    {"field_name": "fasting_glucose", "field_value": "<value or null>", "confidence": <0-1>},
    {"field_name": "postprandial_glucose", "field_value": "<value or null>", "confidence": <0-1>},
    {"field_name": "date_of_test", "field_value": "<value or null>", "confidence": <0-1>}
  ]
}"""

# LLD v2 §5.2 — extraction prompt (surgery report).
EXTRACTION_PROMPT_SURGERY_REPORT_SYSTEM = (
    "You are a medical document field extractor. You read the attached document "
    "image/PDF directly, applied to surgical/discharge notes. Do not attempt "
    "spatial or image-based localization — read stated text/notes in the document only. "
    "You extract only explicitly stated values. You never infer, estimate, or calculate a value "
    "that is not directly present in the document. Respond with valid JSON only, no prose, "
    "no markdown fences."
)
EXTRACTION_PROMPT_SURGERY_REPORT_USER = """\
Extract the following fields from the attached surgical/discharge report.
If a field is not explicitly present, return null for it. For each field also
return a confidence score between 0 and 1 reflecting how clearly it was stated.

Fields: procedure_type, site, date, notes (one-line summary)

Respond in this exact JSON shape:
{
  "fields": [
    {"field_name": "procedure_type", "field_value": "<value or null>", "confidence": <0-1>},
    {"field_name": "site", "field_value": "<value or null>", "confidence": <0-1>},
    {"field_name": "date", "field_value": "<value or null>", "confidence": <0-1>},
    {"field_name": "notes", "field_value": "<value or null>", "confidence": <0-1>}
  ]
}"""

# LLD v2 §5.3 — explanation prompt (used in /predict).
EXPLANATION_PROMPT_SYSTEM = (
    "You are drafting a plain-language explanation for a doctor reviewing "
    "an AI-suggested treatment option. You are explaining a rule-based estimate, "
    "not making a new clinical judgment. Do not state or imply a specific "
    "probability number, and do not invent a confidence value — confidence_score "
    "is supplied to you already and must not be restated as a different number. "
    "2-3 sentences maximum."
)
EXPLANATION_PROMPT_USER = """\
Patient profile summary: {profile_summary}
Treatment: {treatment_name}
Rule fired: {rule_id} → risk={risk_band}, success={success_band},
side_effects={side_effect_band}, improvement={improvement_band}

Write a short explanation of why this treatment produced these bands, referencing
the specific patient factors that mattered (e.g. diabetes status, age, allergies,
current_condition)."""


def _extraction_prompt(doc_type: str) -> tuple[str, str]:
    if doc_type == "blood_report":
        return EXTRACTION_PROMPT_BLOOD_REPORT_SYSTEM, EXTRACTION_PROMPT_BLOOD_REPORT_USER
    # surgery_report and medical_history both use the surgical/discharge template.
    # TODO(spec-gap): LLD §5 defines extraction prompts for blood_report and
    # surgery_report only. `medical_history` is a valid doc_type (§2.1) but has no
    # dedicated template; the nearest explicit template (§5.2) is used instead.
    return EXTRACTION_PROMPT_SURGERY_REPORT_SYSTEM, EXTRACTION_PROMPT_SURGERY_REPORT_USER


def extract_fields(*, file_bytes: bytes, mime_type: str, doc_type: str) -> str:
    """Single Gemini multimodal call: document image/PDF in, structured JSON string out."""
    try:
        system_prompt, user_prompt = _extraction_prompt(doc_type)
        document_part = types.Part.from_bytes(data=file_bytes, mime_type=mime_type)
        response = _client.models.generate_content(
            model=LLM_MODEL_NAME,
            contents=[document_part, user_prompt],
            config=types.GenerateContentConfig(system_instruction=system_prompt),
        )
        return response.text
    except Exception as exc:
        raise GeminiProviderError(f"Gemini extraction call failed: {exc}") from exc


def generate_explanation(
    *,
    profile_summary: str,
    treatment_name: str,
    rule_id: str,
    risk_band: str,
    success_band: str,
    side_effect_band: str,
    improvement_band: str,
) -> str:
    """Plain-language explanation for a doctor reviewing a rule-based estimate (LLD §5.3)."""
    try:
        user_prompt = EXPLANATION_PROMPT_USER.format(
            profile_summary=profile_summary,
            treatment_name=treatment_name,
            rule_id=rule_id,
            risk_band=risk_band,
            success_band=success_band,
            side_effect_band=side_effect_band,
            improvement_band=improvement_band,
        )
        response = _client.models.generate_content(
            model=LLM_MODEL_NAME,
            contents=user_prompt,
            config=types.GenerateContentConfig(system_instruction=EXPLANATION_PROMPT_SYSTEM),
        )
        return response.text
    except Exception as exc:
        raise GeminiProviderError(f"Gemini explanation call failed: {exc}") from exc