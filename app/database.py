from motor.motor_asyncio import AsyncIOMotorClient
from app.config import get_settings

settings = get_settings()

class Database:
    client: AsyncIOMotorClient = None
    
    def connect(self):
        """Create database connection."""
        self.client = AsyncIOMotorClient(settings.MONGODB_URI)
        print("✅ Connected to MongoDB")
        
    def close(self):
        """Close database connection."""
        if self.client:
            self.client.close()
            print("❌ Closed MongoDB connection")
            
    def get_db(self):
        """Get database instance."""
        # Extract database name from URI or default to 'test'
        # URI format: mongodb+srv://<user>:<password>@<cluster>/<dbname>?...
        try:
            return self.client.get_default_database()
        except Exception:
            return self.client["attendance_bot"]

db = Database()

async def get_database():
    return db.get_db()
