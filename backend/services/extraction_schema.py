# LLD v2 §4 — Pydantic models for extracted fields (services/extraction_schema.py).
from typing import Optional

from pydantic import BaseModel, Field


class ExtractedLabFields(BaseModel):
    hba1c: Optional[float] = None
    fasting_glucose: Optional[float] = None
    postprandial_glucose: Optional[float] = None
    date_of_test: Optional[str] = None


class ExtractedSurgeryFields(BaseModel):
    procedure_type: Optional[str] = None
    site: Optional[str] = None
    date: Optional[str] = None
    notes: Optional[str] = None


class FieldWithConfidence(BaseModel):
    field_name: str
    field_value: Optional[str]
    confidence: float = Field(ge=0, le=1)


class ExtractionResult(BaseModel):
    fields: list[FieldWithConfidence]