from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # App Config
    APP_NAME: str = "Attendance Chatbot"
    VERSION: str = "2.0.0"
    DEBUG: bool = False
    
    # MongoDB
    MONGODB_URI: str
    
    # WhatsApp
    WHATSAPP_PHONE_NUMBER_ID: str
    WHATSAPP_ACCESS_TOKEN: str
    WEBHOOK_VERIFY_TOKEN: str
    
    # AI
    OPENAI_API_KEY: str  # Keeping for backward compatibility if needed, or migration
    GOOGLE_API_KEY: str  # For Gemini
    
    # Admin
    ADMIN_KEY: str = "dev_admin_key"

    class Config:
        env_file = ".env"
        extra = "ignore"

@lru_cache()
def get_settings():
    return Settings()
