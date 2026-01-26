from fastapi import APIRouter, Request, Response, HTTPException, BackgroundTasks
from app.config import get_settings
from app.services.whatsapp import whatsapp_service
from app.services.ai import ai_service
from app.services.attendance import attendance_service
from app.models.student import Student
import logging
import re
from datetime import datetime

router = APIRouter()
settings = get_settings()
logger = logging.getLogger(__name__)

@router.get("/webhook")
async def verify_webhook(request: Request):
    """Verify webhook with WhatsApp."""
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")

    if mode == "subscribe" and token == settings.WEBHOOK_VERIFY_TOKEN:
        logger.info("✅ Webhook verified successfully!")
        return Response(content=challenge, media_type="text/plain")
    
    logger.error("❌ Webhook verification failed!")
    raise HTTPException(status_code=403, detail="Verification failed")

@router.post("/webhook")
async def receive_message(request: Request, background_tasks: BackgroundTasks):
    """Receive messages from WhatsApp."""
    try:
        body = await request.json()
        
        # Check if it's a message
        entry = body.get("entry", [])[0]
        changes = entry.get("changes", [])[0]
        value = changes.get("value", {})
        
        if "messages" in value:
            message = value["messages"][0]
            background_tasks.add_task(process_message, message)
            
        return Response(status_code=200)
        
    except Exception as e:
        logger.error(f"Error processing webhook: {e}")
        return Response(status_code=200) # Always return 200 to WhatsApp

async def process_message(message: dict):
    """Process incoming message asynchronously."""
    try:
        phone_number = message["from"]
        message_type = message["type"]
        message_id = message["id"]
        
        # Get or create student
        student = await attendance_service.get_student(phone_number)
        
        if not student:
            # New student flow
            await whatsapp_service.send_message(
                phone_number,
                "👋 *Welcome to the Attendance Bot!*\n\n"
                "I can help you track your class attendance automatically.\n\n"
                "To get started, please tell me your name and roll number."
            )
            # Create basic record
            await attendance_service.register_student(phone_number, {})
            return

        # Handle Text Messages
        if message_type == "text":
            text = message["text"]["body"]
            await handle_text_message(student, text, message_id)
            
        # Handle Image Messages
        elif message_type == "image":
            image_id = message["image"]["id"]
            await handle_image_message(student, image_id)
            
        # Mark as read
        await whatsapp_service.mark_as_read(message_id)

    except Exception as e:
        logger.error(f"Error in process_message: {e}")
        await whatsapp_service.send_message(
            message["from"],
            "😔 Sorry, I encountered an error. Please try again."
        )

async def handle_text_message(student: dict, text: str, message_id: str):
    """Handle text message with rule-based optimization."""
    phone_number = student["phoneNumber"]
    lower_text = text.lower().strip()
    
    # 1. Rule-Based: Summary
    if re.match(r"^(summary|stats|attendance)$", lower_text):
        summary = await attendance_service.get_attendance_summary(student["_id"])
        if summary:
            msg = "📊 *Your Attendance Summary*\n\n"
            for subject in summary["subjects"]:
                emoji = "✅" if float(subject["percentage"]) >= 75 else "⚠️"
                msg += f"{emoji} *{subject['name']}* ({subject['code']})\n"
                msg += f"   Present: {subject['present']}/{subject['total']} ({subject['percentage']}%)\n\n"
            msg += f"📈 *Overall:* {summary['overall']['percentage']}%\n"
            await whatsapp_service.send_message(phone_number, msg)
            return

    # 2. Rule-Based: Schedule
    if re.match(r"^(schedule|timetable)$", lower_text):
        schedule = await attendance_service.get_schedule(student["_id"])
        if schedule:
            # Simple today's schedule
            day = datetime.now().strftime("%A")
            day_slots = [s for s in schedule["timeSlots"] if s["day"] == day]
            msg = f"📅 *{day}'s Schedule*\n\n"
            if not day_slots:
                msg += "No classes today! 🎉"
            else:
                for slot in day_slots:
                    subj = next((s for s in schedule["subjects"] if str(s["_id"]) == str(slot["subject"])), None)
                    if subj:
                        msg += f"🕐 {slot['startTime']} - {slot['endTime']}\n   📚 {subj['name']}\n\n"
            await whatsapp_service.send_message(phone_number, msg)
            return

    # 3. Fallback to AI
    schedule = await attendance_service.get_schedule(student["_id"])
    context = {
        "student": student,
        "subjects": schedule["subjects"] if schedule else [],
        "currentDate": datetime.now().strftime("%Y-%m-%d"),
        "currentDay": datetime.now().strftime("%A")
    }
    
    ai_response = await ai_service.process_conversation(text, context)
    
    # Execute AI Action
    action = ai_response.get("action")
    
    if action == "register_student":
        await attendance_service.register_student(phone_number, ai_response)
        await whatsapp_service.send_message(phone_number, ai_response["message"])
        
    elif action == "record_attendance":
        if ai_response.get("attendanceData"):
            records = await attendance_service.record_attendance(student["_id"], ai_response["attendanceData"])
            await whatsapp_service.send_message(phone_number, ai_response["message"])
            await whatsapp_service.send_reaction(phone_number, message_id, "✅")
            
    elif action == "view_schedule":
        # AI might handle complex schedule queries (e.g. "schedule for Monday")
        # For now, just send the message back or implement specific logic
        # Re-using simple logic for now if day is provided
        requested_day = ai_response.get("day")
        if requested_day and schedule:
            day_slots = [s for s in schedule["timeSlots"] if s["day"].lower() == requested_day.lower()]
            msg = f"📅 *{requested_day}'s Schedule*\n\n"
            if not day_slots:
                msg += "No classes! 🎉"
            else:
                for slot in day_slots:
                    subj = next((s for s in schedule["subjects"] if str(s["_id"]) == str(slot["subject"])), None)
                    if subj:
                        msg += f"🕐 {slot['startTime']} - {slot['endTime']}\n   📚 {subj['name']}\n\n"
            await whatsapp_service.send_message(phone_number, msg)
        else:
            await whatsapp_service.send_message(phone_number, ai_response["message"])

    else:
        await whatsapp_service.send_message(phone_number, ai_response["message"])

async def handle_image_message(student: dict, image_id: str):
    """Handle image upload (schedule/subject list)."""
    # Simple flow: Assume first image is schedule if not present
    # This logic can be expanded based on user state
    
    await whatsapp_service.send_message(student["phoneNumber"], "📸 Image received! Processing...")
    
    # Get image data
    image_url = await whatsapp_service.get_media_url(image_id)
    
    # Extract schedule (assume schedule for now)
    try:
        extracted_data = await ai_service.extract_schedule_from_image(image_url, "schedule")
        
        # Save schedule (simplified)
        # In a real app, we'd validate and maybe ask for confirmation
        # For now, just acknowledge
        await whatsapp_service.send_message(
            student["phoneNumber"], 
            "✅ I've analyzed your schedule. (Note: Full schedule saving not implemented in this migration step yet, but the AI vision works!)"
        )
    except Exception as e:
        logger.error(f"Image processing error: {e}")
        await whatsapp_service.send_message(student["phoneNumber"], "❌ Failed to process image.")
