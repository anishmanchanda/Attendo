from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
from bson import ObjectId
from .student import PyObjectId

class SubjectBase(BaseModel):
    code: str
    name: str
    totalClasses: int = 0

class Subject(SubjectBase):
    id: Optional[PyObjectId] = Field(alias="_id", default=None)
    
    class Config:
        populate_by_name = True
        arbitrary_types_allowed = True
        json_encoders = {ObjectId: str}

class TimeSlotBase(BaseModel):
    day: str
    startTime: str
    endTime: str
    subject: PyObjectId # Reference to Subject

    class Config:
        arbitrary_types_allowed = True
        json_encoders = {ObjectId: str}

class ScheduleBase(BaseModel):
    student: PyObjectId
    semester: int
    subjects: List[Subject]
    timeSlots: List[TimeSlotBase]
    createdAt: datetime = Field(default_factory=datetime.now)

    class Config:
        populate_by_name = True
        arbitrary_types_allowed = True
        json_encoders = {ObjectId: str}

class Schedule(ScheduleBase):
    id: Optional[PyObjectId] = Field(alias="_id", default=None)
