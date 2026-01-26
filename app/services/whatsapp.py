import httpx
import logging
from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

class WhatsAppService:
    def __init__(self):
        self.phone_number_id = settings.WHATSAPP_PHONE_NUMBER_ID
        self.access_token = settings.WHATSAPP_ACCESS_TOKEN
        self.api_url = f"https://graph.facebook.com/v18.0/{self.phone_number_id}/messages"
        self.headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }

    async def send_message(self, to: str, message: str):
        """Send a text message."""
        try:
            clean_number = to.replace("+", "").replace("-", "").replace(" ", "")
            logger.info(f"📤 Sending message to {clean_number}: {message[:50]}...")
            
            payload = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": clean_number,
                "type": "text",
                "text": {"body": message}
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(self.api_url, json=payload, headers=self.headers)
                response.raise_for_status()
                return response.json()
                
        except Exception as e:
            logger.error(f"❌ Error sending message: {e}")
            # Log response body if available
            if isinstance(e, httpx.HTTPStatusError):
                logger.error(f"Response: {e.response.text}")
            raise

    async def send_reaction(self, to: str, message_id: str, emoji: str):
        """Send a reaction to a message."""
        try:
            clean_number = to.replace("+", "").replace("-", "").replace(" ", "")
            
            payload = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": clean_number,
                "type": "reaction",
                "reaction": {
                    "message_id": message_id,
                    "emoji": emoji
                }
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(self.api_url, json=payload, headers=self.headers)
                return response.json()
        except Exception as e:
            logger.error(f"⚠️ Error sending reaction: {e}")

    async def mark_as_read(self, message_id: str):
        """Mark a message as read."""
        try:
            payload = {
                "messaging_product": "whatsapp",
                "status": "read",
                "message_id": message_id
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(self.api_url, json=payload, headers=self.headers)
                return response.json()
        except Exception as e:
            logger.error(f"⚠️ Error marking as read: {e}")

    async def get_media_url(self, media_id: str) -> str:
        """Get the actual URL for a media ID."""
        try:
            async with httpx.AsyncClient() as client:
                # 1. Get media info
                info_url = f"https://graph.facebook.com/v18.0/{media_id}"
                info_res = await client.get(info_url, headers={"Authorization": f"Bearer {self.access_token}"})
                info_res.raise_for_status()
                media_url = info_res.json().get("url")
                
                # 2. Get binary data (we need to return base64 or a publicly accessible URL for Gemini)
                # Gemini supports base64. Let's download and convert.
                media_res = await client.get(media_url, headers={"Authorization": f"Bearer {self.access_token}"})
                media_res.raise_for_status()
                
                import base64
                encoded = base64.b64encode(media_res.content).decode('utf-8')
                mime_type = media_res.headers.get("content-type", "image/jpeg")
                
                return f"data:{mime_type};base64,{encoded}"
                
        except Exception as e:
            logger.error(f"❌ Error getting media: {e}")
            raise

whatsapp_service = WhatsAppService()
