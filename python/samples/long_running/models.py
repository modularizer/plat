from __future__ import annotations

from pydantic import BaseModel, Field


class ImportCatalogInput(BaseModel):
    source: str
    items: int = Field(default=5, ge=1, le=20)


class ImportCatalogOutput(BaseModel):
    source: str
    imported: int
    status: str
