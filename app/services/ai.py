import google.generativeai as genai
import json
import logging
from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

# Configure Gemini
genai.configure(api_key=settings.GOOGLE_API_KEY)

class AIService:
    def __init__(self):
        self.model = genai.GenerativeModel('gemini-flash-latest')
        
    async def process_conversation(self, message: str, student_context: dict) -> dict:
        """Process user message with Gemini."""
        try:
            # Construct prompt
            subjects_text = "No subjects registered yet."
            if student_context.get("subjects"):
                subjects_text = "Student's subjects:\n" + "\n".join([f"- {s['code']}: {s['name']}" for s in student_context["subjects"]])

            system_prompt = f"""You are an intelligent attendance tracking assistant. You handle ALL aspects of student interaction.

Current student context: {json.dumps(student_context, default=str)}
Current date: {student_context.get('currentDate')}
Current day: {student_context.get('currentDay')}

{subjects_text}

Based on the student's message, decide what action to take and respond appropriately.

AVAILABLE ACTIONS:
1. "register_student" - when student wants to register
2. "record_attendance" - when student reports attendance 
3. "get_summary" - when student wants attendance summary
4. "view_schedule" - when student asks about their schedule/timetable/classes
5. "general_conversation" - for any other conversation

For registration, extract name and roll number.
For attendance, parse which subjects they attended/missed.
IMPORTANT: Use the EXACT subject codes from the student's subjects list above.

CRITICAL: When recording attendance:
1. First determine the DAY OF THE WEEK for the date mentioned
2. Set "needsDayFilter: true" if they say "all classes" without specific subjects
3. If specific subjects are mentioned, use those exact codes

ALWAYS respond in this JSON format:
{{
  "action": "register_student|record_attendance|get_summary|view_schedule|general_conversation",
  "message": "Your conversational response to the student",
  "day": "Monday|Tuesday|etc (only for view_schedule)",
  "name": "extracted name",
  "rollNumber": "extracted roll number", 
  "semester": number,
  "attendanceData": {{
    "date": "YYYY-MM-DD",
    "isHoliday": boolean,
    "needsDayFilter": boolean,
    "attendance": [
      {{"subjectCode": "PC-209", "status": "PRESENT|ABSENT|CANCELLED"}}
    ]
  }}
}}
"""
            
            # Call Gemini
            response = self.model.generate_content(
                contents=[
                    {"role": "user", "parts": [system_prompt + f"\n\nUser Message: {message}"]}
                ],
                generation_config={"response_mime_type": "application/json"}
            )
            
            return json.loads(response.text)
            
        except Exception as e:
            logger.error(f"❌ Error in AI processing: {e}")
            # Fallback
            return {
                "action": "general_conversation",
                "message": "I'm having trouble thinking right now. Please try again later."
            }

    async def extract_schedule_from_image(self, image_data: str, image_type: str) -> dict:
        """Extract schedule or subjects from image using Gemini Vision."""
        try:
            prompt = ""
            if image_type == 'subject_list':
                prompt = """Extract all subjects from this image. Return a JSON object with this format:
{
  "subjects": [
    {"code": "CS101", "name": "Computer Science"},
    {"code": "MA101", "name": "Mathematics"}
  ]
}
Extract ALL subjects you can see. Include both the subject code and full name."""
            else:
                prompt = """Extract the complete class schedule/timetable from this image. Return a JSON object with this format:
{
  "schedule": [
    {
      "day": "Monday",
      "slots": [
        {"startTime": "09:00", "endTime": "10:00", "subjectCode": "CS101"}
      ]
    }
  ]
}
Extract ALL time slots for ALL days. Use 24-hour format (HH:MM)."""

            # Handle base64 image
            # image_data is "data:image/jpeg;base64,..."
            header, encoded = image_data.split(",", 1)
            mime_type = header.split(":")[1].split(";")[0]
            
            cookie_picture = {
                'mime_type': mime_type,
                'data': encoded
            }

            response = self.model.generate_content(
                contents=[prompt, cookie_picture],
                generation_config={"response_mime_type": "application/json"}
            )
            
            return json.loads(response.text)

        except Exception as e:
            logger.error(f"❌ Error extracting schedule: {e}")
            raise

ai_service = AIService()
