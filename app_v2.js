require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const WhatsAppBusinessService = require('./services/services_whatsapp_business');
const AIService = require('./services/services_aiService_Version2');
const Student = require('./models/models_Student_Version2');

// Import handlers
const registrationHandler = require('./handlers/registrationHandler');
const scheduleHandler = require('./handlers/scheduleHandler');
const attendanceHandler = require('./handlers/attendanceHandler');

// Validate required environment variables
const requiredEnvVars = [
  'MONGODB_URI',
  'OPENAI_API_KEY',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_ACCESS_TOKEN',
  'WEBHOOK_VERIFY_TOKEN'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingEnvVars.forEach(varName => console.error(`   - ${varName}`));
  process.exit(1);
}

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);

// Initialize services
let whatsappService;
let aiService;
let mongooseConnected = false;

// Connect to MongoDB with retry logic
async function connectDB() {
  if (mongooseConnected) return;

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    mongooseConnected = true;
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    setTimeout(connectDB, 5000);
  }
}

// Initialize services
function initServices() {
  if (!whatsappService) {
    whatsappService = new WhatsAppBusinessService(
      process.env.WHATSAPP_PHONE_NUMBER_ID,
      process.env.WHATSAPP_ACCESS_TOKEN
    );
    console.log('✅ WhatsApp Business Service initialized');
  }

  if (!aiService) {
    aiService = new AIService();
    console.log('✅ AI Service initialized (GPT-4)');
  }

  console.log('✅ All services ready');
}

// Health check endpoints
app.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'WhatsApp Attendance Bot',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongodb: mongooseConnected ? 'connected' : 'disconnected'
  });
});

app.get('/health', (req, res) => {
  const health = {
    status: mongooseConnected ? 'ok' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    services: {
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      whatsapp: whatsappService ? 'initialized' : 'not initialized',
      ai: aiService ? 'initialized' : 'not initialized'
    },
    memory: process.memoryUsage()
  };

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Initialize services and setup webhook
initServices();
whatsappService.setupWebhook(app);

// Handle incoming WhatsApp messages
whatsappService.on('message', async (message) => {
  console.log('\n🔔 New message event');
  console.log('   From:', message.from);
  console.log('   Type:', message.type);
  
  try {
    await connectDB();
    
    const phoneNumber = message.from;
    const messageBody = message.body;

    // Find or create student
    let student = await Student.findOne({ phoneNumber });

    if (!student) {
      console.log('📝 New student detected, creating record...');
      
      student = new Student({
        phoneNumber,
        name: 'New User',
        registrationDate: new Date(),
        isRegistered: false
      });
      await student.save();

      // Send welcome message and enforce registration
      await whatsappService.sendMessage(phoneNumber, registrationHandler.getWelcomeMessage());
      await whatsappService.sendReaction(phoneNumber, message.id, '👋');
      return;
    }

    // STEP 1: ENFORCE REGISTRATION (Must complete first)
    if (registrationHandler.needsRegistration(student)) {
      console.log('⚠️  Registration required - blocking other actions');
      
      // Only allow text messages for registration
      if (message.type === 'text' && messageBody) {
        const aiResponse = await aiService.processConversation(messageBody, {
          student,
          hasSchedule: false
        });

        // Only process registration actions
        if (aiResponse.action === 'register_student') {
          await registrationHandler.handleRegistration(student, phoneNumber, aiResponse, whatsappService);
        } else {
          // Remind to complete registration first
          await whatsappService.sendMessage(phoneNumber, registrationHandler.getRegistrationReminder(student));
        }
      } else {
        await whatsappService.sendMessage(phoneNumber, registrationHandler.getRegistrationReminder(student));
      }
      return;
    }

    // STEP 2: ENFORCE SCHEDULE UPLOAD (Must complete second)
    const needsScheduleUpload = await scheduleHandler.needsSchedule(student);
    
    if (needsScheduleUpload) {
      console.log('⚠️  Schedule upload required - blocking attendance actions');
      
      // Handle image messages for schedule upload
      if (message.type === 'image' && message.image) {
        await scheduleHandler.handleImageMessage(student, phoneNumber, message, whatsappService);
        return;
      }

      // Handle text responses about uploaded images
      if (message.type === 'text' && messageBody && student.lastImageId) {
        const lowerText = messageBody.toLowerCase().trim();
        if (lowerText.includes('subject list') || lowerText.includes('schedule')) {
          await scheduleHandler.handleImageClassification(
            student, 
            phoneNumber, 
            messageBody,
            whatsappService,
            aiService
          );
          return;
        }
      }

      // Block attendance and other actions until schedule is uploaded
      if (message.type === 'text' && messageBody) {
        const aiResponse = await aiService.processConversation(messageBody, {
          student,
          hasSchedule: false
        });

        // Only allow view_schedule or general conversation
        if (aiResponse.action === 'record_attendance') {
          await whatsappService.sendMessage(phoneNumber, scheduleHandler.getScheduleRequiredMessage());
        } else if (aiResponse.action === 'get_summary') {
          await whatsappService.sendMessage(
            phoneNumber,
            '📊 *No Attendance Records Yet*\n\n' +
            'Upload your schedule first, then start marking attendance!\n\n' +
            scheduleHandler.getScheduleRequiredMessage()
          );
        } else {
          // For other queries, remind about schedule upload
          await whatsappService.sendMessage(phoneNumber, aiResponse.message);
          
          setTimeout(async () => {
            await whatsappService.sendMessage(phoneNumber, scheduleHandler.getScheduleUploadPrompt());
          }, 1500);
        }
      }
      return;
    }

    // STEP 3: ALL SET - ALLOW FULL FUNCTIONALITY
    console.log('✅ Student fully registered and has schedule');

    // Handle image messages (additional schedule updates)
    if (message.type === 'image' && message.image) {
      await scheduleHandler.handleImageMessage(student, phoneNumber, message, whatsappService);
      return;
    }

    // Handle text responses about uploaded images
    if (message.type === 'text' && messageBody && student.lastImageId) {
      const lowerText = messageBody.toLowerCase().trim();
      if (lowerText.includes('subject list') || lowerText.includes('schedule')) {
        await scheduleHandler.handleImageClassification(
          student,
          phoneNumber,
          messageBody,
          whatsappService,
          aiService
        );
        return;
      }
    }

    // Process text messages with AI
    if (message.type === 'text' && messageBody) {
      await handleTextMessage(student, phoneNumber, messageBody, message.id);
    }

  } catch (error) {
    console.error('❌ Error processing message:', error);
    
    try {
      await whatsappService.sendMessage(
        message.from,
        '😔 Sorry, I encountered an error processing your message.\n\n' +
        'Please try again in a moment, or contact support if the problem persists.'
      );
    } catch (sendError) {
      console.error('Failed to send error message:', sendError);
    }
  }
});

/**
 * Handle text messages from fully registered students
 */
async function handleTextMessage(student, phoneNumber, text, messageId) {
  try {
    console.log('💬 Processing text message...');
    console.log('📝 User said:', text);
    
    // Process with AI
    const aiResponse = await aiService.processConversation(text, {
      student,
      hasSchedule: true
    });

    console.log('🤖 AI Action:', aiResponse.action);

    // Handle different actions
    switch (aiResponse.action) {
      case 'register_student':
        // Allow updates to registration
        await registrationHandler.handleRegistration(student, phoneNumber, aiResponse, whatsappService);
        break;

      case 'record_attendance':
        await attendanceHandler.handleAttendanceRecording(
          student, 
          phoneNumber, 
          aiResponse, 
          messageId,
          whatsappService
        );
        break;

      case 'get_summary':
        await attendanceHandler.handleSummaryRequest(student, phoneNumber, whatsappService);
        break;

      case 'view_schedule':
        await attendanceHandler.handleViewSchedule(student, phoneNumber, aiResponse, whatsappService);
        break;

      case 'modify_attendance':
        await attendanceHandler.handleModifyAttendance(
          student,
          phoneNumber,
          aiResponse,
          whatsappService
        );
        break;

      default:
        await whatsappService.sendMessage(phoneNumber, aiResponse.message);
    }

    // Mark message as read
    await whatsappService.markAsRead(messageId);

  } catch (error) {
    console.error('Error in handleTextMessage:', error);
    throw error;
  }
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Connect to MongoDB and start server
connectDB().then(() => {
  const PORT = process.env.PORT || 3000;
  
  app.listen(PORT, () => {
    console.log('\n🚀 ========================================');
    console.log('   WhatsApp Attendance Bot v2.0');
    console.log('========================================');
    console.log(`📡 Server running on port ${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`📱 WhatsApp webhook: http://localhost:${PORT}/webhook`);
    console.log(`🤖 AI Model: GPT-4`);
    console.log('========================================');
    console.log('✨ Features:');
    console.log('   1️⃣  Enforced registration flow');
    console.log('   2️⃣  Required schedule upload');
    console.log('   3️⃣  Smart attendance tracking');
    console.log('========================================\n');
    
    if (process.env.NODE_ENV !== 'production') {
      console.log('⚠️  Running in development mode');
      console.log('💡 Use ngrok to expose webhook for testing\n');
    }
  });
}).catch(err => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\n👋 SIGTERM received, shutting down gracefully...');
  try {
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed');
    process.exit(0);
  } catch (error) {
    console.error('Error closing MongoDB:', error);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  console.log('\n👋 SIGINT received, shutting down gracefully...');
  try {
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed');
    process.exit(0);
  } catch (error) {
    console.error('Error closing MongoDB:', error);
    process.exit(1);
  }
});

module.exports = app;
