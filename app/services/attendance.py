from datetime import datetime, timedelta
from typing import List, Optional, Dict
from app.database import get_database
from app.models.student import Student
from app.models.schedule import Schedule
from app.models.attendance import Attendance
from bson import ObjectId

class AttendanceService:
    def __init__(self):
        self.db = None

    async def get_db(self):
        if not self.db:
            self.db = await get_database()
        return self.db

    async def get_student(self, phone_number: str) -> Optional[dict]:
        db = await self.get_db()
        return await db.students.find_one({"phoneNumber": phone_number})

    async def get_schedule(self, student_id: ObjectId) -> Optional[dict]:
        db = await self.get_db()
        # Sort by createdAt desc
        cursor = db.schedules.find({"student": student_id}).sort("createdAt", -1).limit(1)
        try:
            return await cursor.to_list(length=1)[0]
        except IndexError:
            return None

    async def register_student(self, phone_number: str, data: dict) -> dict:
        db = await self.get_db()
        student = await db.students.find_one({"phoneNumber": phone_number})
        
        update_data = {
            "rollNumber": data.get("rollNumber"),
            "semester": data.get("semester"),
            "name": data.get("name") or (student.get("name") if student else "New User")
        }
        
        if student:
            await db.students.update_one(
                {"_id": student["_id"]},
                {"$set": update_data}
            )
            return await db.students.find_one({"_id": student["_id"]})
        else:
            new_student = {
                "phoneNumber": phone_number,
                **update_data,
                "isRegistered": False,
                "createdAt": datetime.now()
            }
            result = await db.students.insert_one(new_student)
            return await db.students.find_one({"_id": result.inserted_id})

    async def record_attendance(self, student_id: ObjectId, attendance_data: dict) -> List[dict]:
        db = await self.get_db()
        student = await db.students.find_one({"_id": student_id})
        schedule = await self.get_schedule(student_id)
        
        if not schedule:
            raise ValueError("Schedule not found")

        date_str = attendance_data["date"]
        date_obj = datetime.strptime(date_str, "%Y-%m-%d")
        day_of_week = date_obj.strftime("%A")
        
        # Filter slots for the day
        day_slots = [
            slot for slot in schedule["timeSlots"] 
            if slot["day"].lower() == day_of_week.lower()
        ]
        
        if not day_slots and not attendance_data.get("isHoliday"):
            raise ValueError(f"No classes scheduled on {day_of_week}")

        records_to_create = []
        
        if attendance_data.get("isHoliday"):
            # Mark all slots as HOLIDAY
            for slot in day_slots:
                subject = next((s for s in schedule["subjects"] if str(s["_id"]) == str(slot["subject"])), None)
                if subject:
                    records_to_create.append({
                        "phoneNumber": student["phoneNumber"],
                        "date": date_obj,
                        "subjectCode": subject["code"],
                        "subjectName": subject["name"],
                        "status": "HOLIDAY",
                        "timeSlot": f"{slot['startTime']}-{slot['endTime']}"
                    })
        
        elif attendance_data.get("needsDayFilter"):
            # Mark all slots with default status
            default_status = attendance_data["attendance"][0]["status"] if attendance_data["attendance"] else "PRESENT"
            
            for slot in day_slots:
                subject = next((s for s in schedule["subjects"] if str(s["_id"]) == str(slot["subject"])), None)
                if subject:
                    records_to_create.append({
                        "phoneNumber": student["phoneNumber"],
                        "date": date_obj,
                        "subjectCode": subject["code"],
                        "subjectName": subject["name"],
                        "status": default_status,
                        "timeSlot": f"{slot['startTime']}-{slot['endTime']}"
                    })
        else:
            # Specific subjects
            for entry in attendance_data["attendance"]:
                # Find subject in schedule
                subject = next((s for s in schedule["subjects"] if s["code"].lower() == entry["subjectCode"].lower()), None)
                if not subject:
                    continue
                    
                # Find slots for this subject on this day
                subject_slots = [
                    slot for slot in day_slots 
                    if str(slot["subject"]) == str(subject["_id"])
                ]
                
                for slot in subject_slots:
                    records_to_create.append({
                        "phoneNumber": student["phoneNumber"],
                        "date": date_obj,
                        "subjectCode": subject["code"],
                        "subjectName": subject["name"],
                        "status": entry.get("status", "PRESENT"),
                        "timeSlot": f"{slot['startTime']}-{slot['endTime']}"
                    })

        # Upsert records
        created_records = []
        for record in records_to_create:
            result = await db.attendance.update_one(
                {
                    "phoneNumber": record["phoneNumber"],
                    "subjectCode": record["subjectCode"],
                    "date": record["date"],
                    "timeSlot": record["timeSlot"]
                },
                {"$set": {**record, "updatedAt": datetime.now()}},
                upsert=True
            )
            created_records.append(record)
            
        return created_records

    async def get_attendance_summary(self, student_id: ObjectId) -> dict:
        db = await self.get_db()
        student = await db.students.find_one({"_id": student_id})
        schedule = await self.get_schedule(student_id)
        
        if not schedule:
            return None
            
        # Get all records
        cursor = db.attendance.find({
            "phoneNumber": student["phoneNumber"],
            "status": {"$in": ["PRESENT", "ABSENT"]}
        })
        records = await cursor.to_list(length=None)
        
        subject_stats = []
        overall_present = 0
        overall_total = 0
        
        for subject in schedule["subjects"]:
            subj_records = [r for r in records if r["subjectCode"] == subject["code"]]
            present = len([r for r in subj_records if r["status"] == "PRESENT"])
            absent = len([r for r in subj_records if r["status"] == "ABSENT"])
            total = present + absent
            percentage = (present / total * 100) if total > 0 else 0
            
            subject_stats.append({
                "code": subject["code"],
                "name": subject["name"],
                "present": present,
                "absent": absent,
                "total": total,
                "percentage": f"{percentage:.1f}"
            })
            
            overall_present += present
            overall_total += total
            
        overall_percentage = (overall_present / overall_total * 100) if overall_total > 0 else 0
        
        return {
            "overall": {
                "present": overall_present,
                "total": overall_total,
                "percentage": f"{overall_percentage:.1f}"
            },
            "subjects": subject_stats
        }

attendance_service = AttendanceService()
