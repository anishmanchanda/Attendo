from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from bson import ObjectId
from .student import PyObjectId

class AttendanceBase(BaseModel):
    phoneNumber: str
    date: datetime
    subjectCode: str
    subjectName: str
    status: str = "PRESENT" # PRESENT, ABSENT, HOLIDAY, CANCELLED
    timeSlot: str = "general"
    notes: str = ""
    createdAt: datetime = Field(default_factory=datetime.now)
    updatedAt: datetime = Field(default_factory=datetime.now)

    class Config:
        populate_by_name = True
        arbitrary_types_allowed = True
        json_encoders = {ObjectId: str}

class Attendance(AttendanceBase):
    id: Optional[PyObjectId] = Field(alias="_id", default=None)
