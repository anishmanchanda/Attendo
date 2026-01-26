import asyncio
import os
from app.database import db
from app.services.ai import ai_service
from app.config import get_settings

async def verify():
    print("🔍 Starting Verification...")
    
    # 1. Verify Config
    settings = get_settings()
    if not settings.GOOGLE_API_KEY:
        print("❌ GOOGLE_API_KEY is missing!")
    else:
        print("✅ GOOGLE_API_KEY found")
        
    if not settings.MONGODB_URI:
        print("❌ MONGODB_URI is missing!")
    else:
        print("✅ MONGODB_URI found")

    # 2. Verify MongoDB
    try:
        db.connect()
        database = await db.get_db()
        # AsyncIOMotorDatabase.command is a coroutine
        await database.command("ping")
        print("✅ MongoDB Connection Successful")
    except Exception as e:
        print(f"❌ MongoDB Connection Failed: {e}")
    finally:
        db.close()

    # 3. Verify Gemini
    try:
        import google.generativeai as genai
        print("📋 Available Models:")
        for m in genai.list_models():
            if 'generateContent' in m.supported_generation_methods:
                print(f"   - {m.name}")

        response = await ai_service.process_conversation("Hello", {"currentDate": "2024-01-01", "currentDay": "Monday"})
        if response:
            print("✅ Gemini API Test Completed")
            print(f"   Response Action: {response.get('action')}")
            if response.get('action') == 'general_conversation' and "trouble thinking" in response.get('message', ''):
                print("   ⚠️  Received Fallback Response (Integration Failed)")
            else:
                print("   🎉 Real AI Response Received")
    except Exception as e:
        print(f"❌ Gemini API Test Failed: {e}")

if __name__ == "__main__":
    asyncio.run(verify())
