# LLD v2 §4 — request/response Pydantic models.
from dataclasses import dataclass, field
from typing import Literal, Optional

from pydantic import BaseModel, Field


class TreatmentPrediction(BaseModel):
    treatment_name: str
    risk_band: Literal["low", "medium", "high"]
    success_band: Literal["low", "medium", "high"]
    side_effect_band: Literal["low", "medium", "high"]
    improvement_band: Literal["low", "medium", "high"]   # NEW
    confidence_score: float = Field(ge=0, le=1)           # NEW — static, from rule table only
    explanation: str
    rule_id: str


class SimilarityMatch(BaseModel):
    matched_patient_id: str
    similarity_score: float
    approved_treatment: Optional[str] = None
    outcome_notes: Optional[str] = None


class AuthenticatedCaller(BaseModel):
    """Populated by auth_service.verify_caller() — see §11."""
    user_id: str
    role: Literal["patient", "doctor"]
    patient_id: Optional[str] = None  # resolved only for role == "patient"


@dataclass
class Patient:
    """Attribute-accessable patient row used by the heuristic engine and embedding service."""
    id: str
    age: Optional[int]
    gender: Optional[str]
    is_pregnant: bool
    is_diabetic: bool
    current_condition: Optional[str]
    pulse: Optional[int]
    lifestyle_healthy: Optional[bool]
    allergies: list[str] = field(default_factory=list)

    @classmethod
    def from_row(cls, row: dict) -> "Patient":
        return cls(
            id=row["id"],
            age=row.get("age"),
            gender=row.get("gender"),
            is_pregnant=bool(row.get("is_pregnant", False)),
            is_diabetic=bool(row.get("is_diabetic", False)),
            current_condition=row.get("current_condition"),
            pulse=row.get("pulse"),
            lifestyle_healthy=row.get("lifestyle_healthy"),
            allergies=list(row.get("allergies") or []),
        )