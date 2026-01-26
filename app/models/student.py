from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from bson import ObjectId

class PyObjectId(ObjectId):
    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v, values=None, **kwargs):
        if not ObjectId.is_valid(v):
            raise ValueError("Invalid objectid")
        return ObjectId(v)

    @classmethod
    def __get_pydantic_json_schema__(cls, core_schema, handler):
        return {"type": "string"}

class UploadState(BaseModel):
    subjectListImageId: Optional[str] = None
    scheduleImageId: Optional[str] = None

class StudentBase(BaseModel):
    phoneNumber: str
    rollNumber: Optional[str] = None
    name: Optional[str] = "New User"
    semester: Optional[int] = None
    isRegistered: bool = False
    registrationDate: datetime = Field(default_factory=datetime.now)
    subjects: List[str] = [] # List of Subject ObjectIds as strings
    chatState: str = "IDLE"
    tempData: Optional[Dict[str, Any]] = None
    lastImageId: Optional[str] = None
    lastImageCaption: Optional[str] = None
    uploadState: Optional[UploadState] = None
    createdAt: datetime = Field(default_factory=datetime.now)

    class Config:
        populate_by_name = True
        arbitrary_types_allowed = True
        json_encoders = {ObjectId: str}

class StudentCreate(StudentBase):
    pass

class Student(StudentBase):
    id: Optional[PyObjectId] = Field(alias="_id", default=None)
