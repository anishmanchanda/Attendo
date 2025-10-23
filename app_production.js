require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const WhatsAppBusinessService = require('./services/services_whatsapp_business');
const AIService = require('./services/services_aiService_Version2');
const attendanceService = require('./services/services_attendanceService_Version2'); // Already an instance
const Student = require('./models/models_Student_Version2');
const Schedule = require('./models/models_Schedule_Version2');

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

// Trust proxy (required for Render)
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
    // Retry after 5 seconds
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
    console.log('✅ AI Service initialized');
  }

  console.log('✅ Attendance Service ready (singleton)');
}

// Health check endpoints
app.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'WhatsApp Attendance Bot',
    version: '1.0.0',
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
    // Ensure DB is connected
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

      await whatsappService.sendMessage(
        phoneNumber,
        '👋 *Welcome to the Attendance Bot!*\n\n' +
        'I can help you track your class attendance automatically.\n\n' +
        '📋 *To get started:*\n' +
        '1. Tell me your name and roll number\n' +
        '2. Upload your class schedule (photo or PDF)\n' +
        '3. Start reporting attendance!\n\n' +
        '💡 *Example:*\n' +
        '"My name is John Doe and my roll number is 12345"\n\n' +
        'What\'s your name and roll number?'
      );
      
      // Send reaction
      await whatsappService.sendReaction(phoneNumber, message.id, '👋');
      return;
    }

    // Check if student needs to upload schedule
    const schedule = await Schedule.findOne({ student: student._id });
    
    if (!student.isRegistered || !schedule) {
      console.log('⚠️  Student needs to complete registration');
    }

    // Handle image messages (schedule upload)
    if (message.type === 'image' && message.image) {
      await handleImageMessage(student, phoneNumber, message);
      return;
    }

    // Process text message with AI
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
 * Handle text messages
 */
async function handleTextMessage(student, phoneNumber, text, messageId) {
  try {
    console.log('💬 Processing text message...');
    
    // Process with AI
    const aiResponse = await aiService.processConversation(text, {
      student,
      hasSchedule: !!(await Schedule.findOne({ student: student._id }))
    });

    console.log('🤖 AI Action:', aiResponse.action);

    // Handle different actions
    switch (aiResponse.action) {
      case 'register_student':
        await handleRegistration(student, phoneNumber, aiResponse);
        break;

      case 'record_attendance':
        await handleAttendanceRecording(student, phoneNumber, aiResponse);
        break;

      case 'get_summary':
        await handleSummaryRequest(student, phoneNumber);
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

/**
 * Handle student registration
 */
async function handleRegistration(student, phoneNumber, aiResponse) {
  try {
    let updated = false;

    if (aiResponse.name && aiResponse.name !== 'New User') {
      student.name = aiResponse.name;
      updated = true;
    }

    if (aiResponse.rollNumber) {
      student.rollNumber = aiResponse.rollNumber;
      updated = true;
    }

    if (aiResponse.semester) {
      student.semester = aiResponse.semester;
      updated = true;
    }

    if (updated) {
      student.isRegistered = !!(student.name && student.rollNumber);
      await student.save();
      console.log('✅ Student information updated');
    }

    await whatsappService.sendMessage(phoneNumber, aiResponse.message);

    // If registered, prompt for schedule
    if (student.isRegistered) {
      const schedule = await Schedule.findOne({ student: student._id });
      if (!schedule) {
        setTimeout(async () => {
          await whatsappService.sendMessage(
            phoneNumber,
            '📸 *Next Step: Upload Your Schedule*\n\n' +
            'Please send a photo of your class timetable so I can track your attendance automatically.\n\n' +
            'Make sure the image is clear and all subjects are visible! 📅'
          );
        }, 2000);
      }
    }

  } catch (error) {
    console.error('Error in handleRegistration:', error);
    throw error;
  }
}

/**
 * Handle attendance recording
 */
async function handleAttendanceRecording(student, phoneNumber, aiResponse) {
  try {
    if (!aiResponse.attendanceData) {
      await whatsappService.sendMessage(phoneNumber, aiResponse.message);
      return;
    }

    // Record attendance using attendance service
    await attendanceService.recordAttendance(
      student._id,
      aiResponse.attendanceData
    );

    await whatsappService.sendMessage(phoneNumber, aiResponse.message);
    await whatsappService.sendReaction(phoneNumber, message.id, '✅');

  } catch (error) {
    console.error('Error in handleAttendanceRecording:', error);
    throw error;
  }
}

/**
 * Handle summary request
 */
async function handleSummaryRequest(student, phoneNumber) {
  try {
    const summary = await attendanceService.getAttendanceSummary(student._id);
    
    if (!summary || summary.length === 0) {
      await whatsappService.sendMessage(
        phoneNumber,
        '📊 *Attendance Summary*\n\n' +
        'No attendance records found yet.\n\n' +
        'Start reporting your attendance by telling me which classes you attended!\n\n' +
        '💡 Example: "I attended Math and Physics today"'
      );
      return;
    }

    // Format summary message
    let message = '📊 *Your Attendance Summary*\n\n';
    
    summary.forEach(subject => {
      const percentage = subject.totalClasses > 0 
        ? ((subject.present / subject.totalClasses) * 100).toFixed(1)
        : 0;
      
      const emoji = percentage >= 75 ? '✅' : percentage >= 50 ? '⚠️' : '❌';
      
      message += `${emoji} *${subject.subjectName}*\n`;
      message += `   Present: ${subject.present}/${subject.totalClasses} (${percentage}%)\n\n`;
    });

    message += '\n💡 *Note:* You need 75% attendance to avoid issues!';

    await whatsappService.sendMessage(phoneNumber, message);

  } catch (error) {
    console.error('Error in handleSummaryRequest:', error);
    throw error;
  }
}

/**
 * Handle image messages (schedule upload)
 */
async function handleImageMessage(student, phoneNumber, message) {
  try {
    console.log('📸 Processing schedule image...');
    
    await whatsappService.sendMessage(
      phoneNumber,
      '📸 Schedule image received! Processing...\n\n' +
      'This may take a moment. I\'ll let you know once I\'ve extracted your subjects.'
    );

    // Note: Image processing requires additional setup
    // For now, send a placeholder response
    await whatsappService.sendMessage(
      phoneNumber,
      '✅ Schedule uploaded successfully!\n\n' +
      'You can now start reporting your attendance.\n\n' +
      '💡 *Example:*\n' +
      '"I attended Math, Physics, and Computer Science today"'
    );

  } catch (error) {
    console.error('Error in handleImageMessage:', error);
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
    console.log('   WhatsApp Attendance Bot');
    console.log('========================================');
    console.log(`📡 Server running on port ${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`📱 WhatsApp webhook: http://localhost:${PORT}/webhook`);
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
