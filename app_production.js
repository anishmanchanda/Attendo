require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const WhatsAppBusinessService = require('./services/services_whatsapp_business');
const AIService = require('./services/services_aiService_Version2');
const attendanceService = require('./services/services_attendanceService_Production'); // Production version
const monitoringService = require('./services/services_monitoring');
const Student = require('./models/models_Student_Version2');
const { Schedule, Subject } = require('./models/models_Schedule_Version2');

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

// Monitoring middleware - track request start time
app.use((req, res, next) => {
  req.startTime = Date.now();
  
  // Track request from WhatsApp
  const phoneNumber = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
  if (phoneNumber) {
    monitoringService.trackRequest(phoneNumber);
  }
  
  next();
});

// Response time tracking
app.use((req, res, next) => {
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    monitoringService.trackRequestTime(duration);
  });
  next();
});

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
    version: '2.0.0-production',
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

// Metrics endpoint for monitoring (admin only)
app.get('/metrics', (req, res) => {
  const adminKey = process.env.ADMIN_KEY || 'dev_admin_key';
  if (req.query.key !== adminKey) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  res.json({
    ...monitoringService.getMetrics(),
    serverUptime: Math.floor(process.uptime()) + 's',
    memory: {
      rss: (process.memoryUsage().rss / 1024 / 1024).toFixed(2) + ' MB',
      heapUsed: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + ' MB',
      heapTotal: (process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2) + ' MB'
    },
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    version: '2.0.0-production'
  });
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
    const schedule = await Schedule.findOne({ student: student._id }).sort({ createdAt: -1 });
    
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
    console.log('📝 User said:', text);
    
    // Check if user is responding to image upload prompt
    const lowerText = text.toLowerCase().trim();
    if (student.lastImageId && (lowerText.includes('subject list') || lowerText.includes('schedule'))) {
      await handleImageClassification(student, phoneNumber, text);
      return;
    }
    
    // Get student's schedule to provide context to AI
    const schedule = await Schedule.findOne({ student: student._id }).sort({ createdAt: -1 });
    
    // Build subjects context for AI
    let subjectsContext = null;
    if (schedule && schedule.subjects.length > 0) {
      subjectsContext = schedule.subjects.map(s => ({
        code: s.code,
        name: s.name
      }));
    }
    
    // Process with AI
    const aiResponse = await aiService.processConversation(text, {
      student,
      hasSchedule: !!schedule,
      subjects: subjectsContext
    });

    console.log('🤖 AI Action:', aiResponse.action);

    // Handle different actions
    switch (aiResponse.action) {
      case 'register_student':
        await handleRegistration(student, phoneNumber, aiResponse);
        break;

      case 'record_attendance':
        await handleAttendanceRecording(student, phoneNumber, aiResponse, messageId);
        break;

      case 'get_summary':
        await handleSummaryRequest(student, phoneNumber);
        break;

      case 'view_schedule':
        await handleViewSchedule(student, phoneNumber, aiResponse);
        break;

      case 'view_attendance_details':
        await handleViewAttendanceDetails(student, phoneNumber, aiResponse);
        break;

      case 'modify_attendance':
        await handleModifyAttendance(student, phoneNumber, aiResponse);
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
      // Check if this roll number already belongs to this student
      if (student.rollNumber !== aiResponse.rollNumber) {
        // Check if another student has this roll number
        const existingStudent = await Student.findOne({ rollNumber: aiResponse.rollNumber });
        if (existingStudent && existingStudent._id.toString() !== student._id.toString()) {
          await whatsappService.sendMessage(
            phoneNumber,
            '⚠️ This roll number is already registered to another account.\n\nIf this is your roll number, please contact support.'
          );
          return;
        }
        student.rollNumber = aiResponse.rollNumber;
        updated = true;
      }
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
      const schedule = await Schedule.findOne({ student: student._id }).sort({ createdAt: -1 });
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
async function handleAttendanceRecording(student, phoneNumber, aiResponse, messageId) {
  try {
    if (!aiResponse.attendanceData) {
      await whatsappService.sendMessage(phoneNumber, aiResponse.message);
      return;
    }

    console.log('📝 Recording attendance:', {
      phoneNumber: phoneNumber,
      date: aiResponse.attendanceData.date,
      isHoliday: aiResponse.attendanceData.isHoliday,
      attendance: aiResponse.attendanceData.attendance
    });

    // Record attendance using attendance service
    const records = await attendanceService.recordAttendance(
      student._id,
      aiResponse.attendanceData
    );

    console.log(`✅ Recorded ${records.length} attendance entries`);

    await whatsappService.sendMessage(phoneNumber, aiResponse.message);
    
    // Send reaction if messageId is available
    if (messageId) {
      await whatsappService.sendReaction(phoneNumber, messageId, '✅');
    }

  } catch (error) {
    console.error('Error in handleAttendanceRecording:', error);
    await whatsappService.sendMessage(
      phoneNumber,
      '😔 Sorry, I had trouble recording your attendance. Please try again!'
    );
    throw error;
  }
}

/**
 * Handle viewing schedule for a specific day
 */
async function handleViewSchedule(student, phoneNumber, aiResponse) {
  try {
    // Normalize the day name: capitalize first letter, lowercase rest
    let requestedDay = aiResponse.day || new Date().toLocaleDateString('en-US', { weekday: 'long' });
    requestedDay = requestedDay.charAt(0).toUpperCase() + requestedDay.slice(1).toLowerCase();
    
    console.log(`📅 Fetching schedule for ${requestedDay}`);
    
    // Get student's MOST RECENT schedule (subjects are subdocuments, no need to populate)
    const schedule = await Schedule.findOne({ student: student._id }).sort({ createdAt: -1 });
    
    if (!schedule) {
      await whatsappService.sendMessage(
        phoneNumber,
        '📅 *Schedule Not Found*\n\n' +
        'You haven\'t uploaded your schedule yet!\n\n' +
        '📸 Please send a photo of your timetable to get started.'
      );
      return;
    }
    
    console.log(`📋 Schedule found with ${schedule.subjects.length} subjects and ${schedule.timeSlots.length} time slots`);
    console.log(`📋 Available days: ${[...new Set(schedule.timeSlots.map(s => s.day))].join(', ')}`);
    
    // Filter time slots for the requested day (case-insensitive comparison)
    const daySlots = schedule.timeSlots.filter(slot => 
      slot.day.toLowerCase() === requestedDay.toLowerCase()
    );
    
    console.log(`🔍 Found ${daySlots.length} slots for ${requestedDay}`);
    if (daySlots.length > 0) {
      console.log('📋 First slot details:', {
        day: daySlots[0].day,
        subject: daySlots[0].subject,
        startTime: daySlots[0].startTime
      });
    }
    
    if (daySlots.length === 0) {
      await whatsappService.sendMessage(
        phoneNumber,
        `📅 *${requestedDay}'s Schedule*\n\n` +
        `🎉 No classes scheduled for ${requestedDay}!\n\n` +
        `Enjoy your day off! 😊`
      );
      return;
    }
    
    // Sort slots by start time
    daySlots.sort((a, b) => {
      const timeA = a.startTime.split(':').map(Number);
      const timeB = b.startTime.split(':').map(Number);
      return timeA[0] * 60 + timeA[1] - (timeB[0] * 60 + timeB[1]);
    });
    
    // Build schedule message
    let message = `📅 *${requestedDay}'s Schedule*\n\n`;
    message += `You have ${daySlots.length} class${daySlots.length > 1 ? 'es' : ''} today:\n\n`;
    
    for (const slot of daySlots) {
      // Find the subject details from the populated subjects array
      const subject = schedule.subjects.find(s => s._id.toString() === slot.subject.toString());
      
      console.log(`🔍 Slot ${slot.startTime}: Looking for subject ${slot.subject}, Found: ${subject ? subject.code : 'NOT FOUND'}`);
      
      if (subject) {
        message += `🕐 *${slot.startTime} - ${slot.endTime}*\n`;
        message += `   📚 ${subject.code} - ${subject.name}\n\n`;
      } else {
        console.log(`❌ WARNING: Subject not found for slot! Slot subject ID: ${slot.subject}`);
        console.log(`   Available subject IDs in schedule:`, schedule.subjects.map(s => s._id.toString()));
      }
    }
    
    message += `\n💡 Don't forget to mark your attendance after classes!`;
    
    await whatsappService.sendMessage(phoneNumber, message);
    
  } catch (error) {
    console.error('Error in handleViewSchedule:', error);
    await whatsappService.sendMessage(
      phoneNumber,
      '😔 Sorry, I had trouble fetching your schedule.\n\nPlease try again!'
    );
    throw error;
  }
}

/**
 * Handle summary request
 */
async function handleSummaryRequest(student, phoneNumber) {
  try {
    const summary = await attendanceService.getAttendanceSummary(student._id);
    
    if (!summary || !summary.subjects || summary.subjects.length === 0) {
      await whatsappService.sendMessage(
        phoneNumber,
        '📊 *Attendance Summary*\n\n' +
        'No attendance records found yet.\n\n' +
        '📸 *First Step:* Upload your class schedule by sending a photo of your timetable.\n\n' +
        '📝 *Then:* Start reporting your attendance by telling me which classes you attended!\n\n' +
        '💡 Example: "I attended Math and Physics today"'
      );
      return;
    }

    // Format summary message
    let message = '📊 *Your Attendance Summary*\n\n';
    
    summary.subjects.forEach(subject => {
      const percentage = subject.total > 0 
        ? ((subject.present / subject.total) * 100).toFixed(1)
        : 0;
      
      const emoji = percentage >= 75 ? '✅' : percentage >= 50 ? '⚠️' : '❌';
      
      message += `${emoji} *${subject.name}* (${subject.code})\n`;
      message += `   Present: ${subject.present}/${subject.total} (${percentage}%)\n\n`;
    });

    message += `\n📈 *Overall:* ${summary.overall.present}/${summary.overall.total} (${summary.overall.percentage}%)\n`;
    message += '\n💡 *Note:* You need 75% attendance to avoid issues!';

    await whatsappService.sendMessage(phoneNumber, message);

  } catch (error) {
    console.error('Error in handleSummaryRequest:', error);
    throw error;
  }
}

/**
 * Handle viewing attendance details for a specific subject
 */
async function handleViewAttendanceDetails(student, phoneNumber, aiResponse) {
  try {
    const subjectCode = aiResponse.subjectCode;
    
    if (!subjectCode) {
      await whatsappService.sendMessage(phoneNumber, aiResponse.message);
      return;
    }
    
    // Get schedule to find total classes and subject name
    const schedule = await Schedule.findOne({ student: student._id }).sort({ createdAt: -1 });
    
    if (!schedule) {
      await whatsappService.sendMessage(phoneNumber, 'Please upload your schedule first.');
      return;
    }
    
    // Find the subject in schedule
    const subject = schedule.subjects.find(s => 
      s.code.toLowerCase() === subjectCode.toLowerCase()
    );
    
    if (!subject) {
      await whatsappService.sendMessage(
        phoneNumber,
        `❌ Subject ${subjectCode} not found in your schedule.`
      );
      return;
    }
    
    // Count total time slots for this subject
    const totalSlots = schedule.timeSlots.filter(slot => 
      slot.subject.toString() === subject._id.toString()
    ).length;
    
    // Get attendance records for this subject
    const AttendanceRecord = require('./models/models_Attendance_Version2');
    const records = await AttendanceRecord.find({ 
      phoneNumber: student.phoneNumber,
      subjectCode: subject.code
    }).sort({ date: 1 });
    
    // Group by status
    const present = records.filter(r => r.status === 'PRESENT');
    const explicitAbsent = records.filter(r => r.status === 'ABSENT');
    
    // Calculate actual absent: Total scheduled classes - Present classes
    const actualAbsent = totalSlots - present.length;
    
    const percentage = totalSlots > 0 ? ((present.length / totalSlots) * 100).toFixed(1) : 0;
    
    let message = `📊 *${subject.code} - ${subject.name}*\n\n`;
    message += `✅ Present: ${present.length}/${totalSlots} (${percentage}%)\n`;
    message += `❌ Absent/Not Marked: ${actualAbsent}\n`;
    message += `📚 Total Classes in Schedule: ${totalSlots}\n\n`;
    
    if (records.length === 0) {
      message += `⚠️ *No attendance marked yet*\n`;
      message += `All ${totalSlots} classes count as absent until marked.\n\n`;
      message += `💡 Say "I attended all classes today" to mark attendance.`;
    } else if (actualAbsent > 0) {
      message += `*Classes Not Attended:*\n`;
      
      // Show explicitly marked absent classes
      if (explicitAbsent.length > 0) {
        message += `\n📍 *Marked as Absent:*\n`;
        explicitAbsent.forEach(r => {
          const date = new Date(r.date).toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            weekday: 'short'
          });
          const time = r.timeSlot !== 'general' ? ` (${r.timeSlot})` : '';
          message += `❌ ${date}${time}\n`;
        });
      }
      
      // Calculate unrecorded classes
      const unrecorded = actualAbsent - explicitAbsent.length;
      if (unrecorded > 0) {
        message += `\n⚠️ *${unrecorded} class${unrecorded > 1 ? 'es' : ''} not recorded*\n`;
        message += `(These count as absent for attendance percentage)\n`;
      }
      message += `\n`;
    } else if (present.length > 0) {
      message += `✅ *Perfect attendance for all marked classes!*\n\n`;
    }
    
    message += `\n💡 To correct any mistake, say: "Mark me present/absent for ${subjectCode} on [date]"`;
    
    await whatsappService.sendMessage(phoneNumber, message);
    
  } catch (error) {
    console.error('Error in handleViewAttendanceDetails:', error);
    await whatsappService.sendMessage(
      phoneNumber,
      '😔 Sorry, I had trouble fetching attendance details. Please try again!'
    );
  }
}

/**
 * Handle modifying attendance record
 */
async function handleModifyAttendance(student, phoneNumber, aiResponse) {
  try {
    const { subjectCode, date, status } = aiResponse;
    
    if (!subjectCode || !date || !status) {
      await whatsappService.sendMessage(
        phoneNumber,
        '❓ Please specify:\n' +
        '• Subject code (e.g., PC-209)\n' +
        '• Date (e.g., "27th October" or "Monday")\n' +
        '• Status (present or absent)\n\n' +
        'Example: "Mark me present for PC-209 on 27th October"'
      );
      return;
    }
    
    const AttendanceRecord = require('./models/models_Attendance_Version2');
    const Schedule = require('./models/models_Schedule_Version2');
    
    // Get the schedule to find subject details
    const schedule = await Schedule.findOne({ student: student._id }).sort({ createdAt: -1 });
    const subject = schedule.subjects.find(s => 
      s.code.toLowerCase() === subjectCode.toLowerCase()
    );
    
    if (!subject) {
      await whatsappService.sendMessage(
        phoneNumber,
        `❌ Subject ${subjectCode} not found in your schedule.`
      );
      return;
    }
    
    // Parse date
    const targetDate = new Date(date);
    const dayOfWeek = targetDate.toLocaleDateString('en-US', { weekday: 'long' });
    
    // Get time slots for this subject on this day
    const daySlots = schedule.timeSlots.filter(slot => 
      slot.day === dayOfWeek &&
      slot.subject.toString() === subject._id.toString()
    );
    
    if (daySlots.length === 0) {
      await whatsappService.sendMessage(
        phoneNumber,
        `❌ ${subjectCode} is not scheduled on ${dayOfWeek}s.`
      );
      return;
    }
    
    // Update or create attendance for each slot
    let updated = 0;
    for (const slot of daySlots) {
      const timeSlotKey = `${slot.startTime}-${slot.endTime}`;
      
      const record = await AttendanceRecord.findOneAndUpdate(
        {
          phoneNumber: student.phoneNumber,
          subjectCode: subject.code,
          date: {
            $gte: new Date(targetDate.setHours(0, 0, 0, 0)),
            $lt: new Date(targetDate.setHours(23, 59, 59, 999))
          },
          timeSlot: timeSlotKey
        },
        {
          phoneNumber: student.phoneNumber,
          subjectCode: subject.code,
          subjectName: subject.name,
          date: targetDate,
          status: status.toUpperCase(),
          timeSlot: timeSlotKey,
          notes: 'Modified by student'
        },
        { upsert: true, new: true }
      );
      
      updated++;
    }
    
    await whatsappService.sendMessage(
      phoneNumber,
      `✅ Updated ${updated} attendance record(s) for ${subjectCode} on ${dayOfWeek}, ${targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}\n\n` +
      `Status: ${status.toUpperCase()}\n\n` +
      `💡 Check your summary with "show my attendance"`
    );
    
  } catch (error) {
    console.error('Error in handleModifyAttendance:', error);
    await whatsappService.sendMessage(
      phoneNumber,
      '😔 Sorry, I had trouble modifying attendance. Please try again!'
    );
  }
}

/**
 * Handle image classification (subject list vs schedule)
 */
async function handleImageClassification(student, phoneNumber, text) {
  try {
    const lowerText = text.toLowerCase().trim();
    
    if (!student.uploadState) {
      student.uploadState = {
        subjectListImageId: null,
        scheduleImageId: null
      };
    }
    
    if (lowerText.includes('subject list')) {
      student.uploadState.subjectListImageId = student.lastImageId;
      student.lastImageId = null;
      await student.save();
      
      await whatsappService.sendMessage(
        phoneNumber,
        '✅ Subject list image saved!\n\n' +
        '📸 Now send your timetable/schedule image and reply "schedule"'
      );
      
    } else if (lowerText.includes('schedule')) {
      student.uploadState.scheduleImageId = student.lastImageId;
      student.lastImageId = null;
      await student.save();
      
      // Check if we have both images
      if (student.uploadState.subjectListImageId && student.uploadState.scheduleImageId) {
        await processCompleteSchedule(student, phoneNumber);
      } else {
        await whatsappService.sendMessage(
          phoneNumber,
          '✅ Schedule image saved!\n\n' +
          '📸 Now send your subject list image and reply "subject list"'
        );
      }
    }
    
  } catch (error) {
    console.error('Error in handleImageClassification:', error);
    throw error;
  }
}

/**
 * Process complete schedule once both images are uploaded
 */
async function processCompleteSchedule(student, phoneNumber) {
  try {
    await whatsappService.sendMessage(
      phoneNumber,
      '🎉 Both images received!\n\n' +
      '🤖 Using AI Vision to extract your schedule...\n\n' +
      'This may take 10-20 seconds. Please wait! ⏳'
    );
    
    // Get WhatsApp media URLs for both images
    const subjectListUrl = await whatsappService.getMediaUrl(student.uploadState.subjectListImageId);
    const scheduleUrl = await whatsappService.getMediaUrl(student.uploadState.scheduleImageId);
    
    console.log('📸 Extracting subject list from image...');
    const subjectsData = await aiService.extractScheduleFromImage(subjectListUrl, 'subject_list');
    
    console.log('📸 Extracting timetable from image...');
    const scheduleData = await aiService.extractScheduleFromImage(scheduleUrl, 'schedule');
    
    console.log('✅ GPT Vision Response:');
    console.log('   Subjects:', JSON.stringify(subjectsData, null, 2));
    console.log('   Schedule:', JSON.stringify(scheduleData, null, 2));
    
    // Validate extracted data
    if (!subjectsData?.subjects || subjectsData.subjects.length === 0) {
      throw new Error('No subjects extracted from subject list image');
    }
    
    if (!scheduleData?.schedule || scheduleData.schedule.length === 0) {
      throw new Error('No schedule data extracted from timetable image');
    }
    
    // Create a map for quick subject code lookup (normalize codes by removing dashes and making uppercase)
    const normalizeCode = (code) => code.replace(/[-\s]/g, '').toUpperCase();
    const subjectMap = new Map();
    subjectsData.subjects.forEach(s => {
      const normalized = normalizeCode(s.code);
      subjectMap.set(normalized, s);
      // Also store with original code
      subjectMap.set(s.code, s);
    });
    
    console.log('📋 Subject codes available:', Array.from(subjectMap.keys()));
    
    // Create schedule in database with subjects as subdocuments
    const schedule = new Schedule({
      student: student._id,
      semester: student.semester || 1,
      subjects: subjectsData.subjects.map(s => ({
        code: s.code,
        name: s.name,
        totalClasses: 0
      })),
      timeSlots: []
    });
    
    // IMPORTANT: Save the schedule first to generate _id for subdocuments
    await schedule.save();
    console.log('✅ Schedule saved, subdocuments now have _id values');
    
    // Add time slots from schedule
    let slotsAdded = 0;
    let skippedSlots = [];
    
    console.log('\n📅 Processing time slots from schedule data:');
    console.log(`   Total days: ${scheduleData.schedule.length}`);
    
    for (const dayData of scheduleData.schedule) {
      console.log(`\n📅 Processing ${dayData.day}:`, dayData.slots?.length || 0, 'slots');
      
      if (!dayData.slots || dayData.slots.length === 0) {
        console.log(`   ⚠️  No slots found for ${dayData.day}`);
        continue;
      }
      
      for (const slot of dayData.slots) {
        console.log(`\n   🔍 Processing slot: ${slot.startTime}-${slot.endTime}, Subject: "${slot.subjectCode}"`);
        
        // Extract base subject code (remove teacher names, lab groups, etc.)
        // Examples: "PC209/AH" -> "PC209", "PC253/TBA/ETL312/Grp A" -> "PC253"
        let baseCode = slot.subjectCode.split('/')[0].trim();
        console.log(`      Base code extracted: "${baseCode}"`);
        
        // Try to find matching subject using multiple strategies
        const normalizedSlotCode = normalizeCode(baseCode);
        console.log(`      Normalized code: "${normalizedSlotCode}"`);
        
        // Strategy 1: Exact match with original code
        let matchingSubject = subjectMap.get(slot.subjectCode);
        
        // Strategy 2: Match with base code (before first slash)
        if (!matchingSubject) {
          matchingSubject = subjectMap.get(baseCode);
        }
        
        // Strategy 3: Try normalized version
        if (!matchingSubject) {
          matchingSubject = subjectMap.get(normalizedSlotCode);
        }
        
        console.log(`      Direct lookup result: ${matchingSubject ? matchingSubject.code : 'NOT FOUND'}`);
        
        // Strategy 4: Search through all subjects for partial match
        if (!matchingSubject) {
          console.log(`      Trying partial match...`);
          for (const [key, subject] of subjectMap.entries()) {
            const normalizedKey = normalizeCode(key);
            if (normalizedKey === normalizedSlotCode || normalizedKey.includes(normalizedSlotCode) || normalizedSlotCode.includes(normalizedKey)) {
              matchingSubject = subject;
              console.log(`      ✅ Found via partial match: "${key}" -> "${subject.code}"`);
              break;
            }
          }
        }
        
        if (matchingSubject) {
          // Find the subject subdocument in schedule.subjects array (now with _id)
          const subjectSubdoc = schedule.subjects.find(s => 
            normalizeCode(s.code) === normalizeCode(matchingSubject.code)
          );
          
          console.log(`      Looking for subdocument with code: "${matchingSubject.code}"`);
          console.log(`      Found subdocument: ${subjectSubdoc ? 'YES' : 'NO'}`);
          
          if (subjectSubdoc && subjectSubdoc._id) {
            console.log(`      Subdocument _id: ${subjectSubdoc._id}`);
            schedule.timeSlots.push({
              day: dayData.day,
              startTime: slot.startTime,
              endTime: slot.endTime,
              subject: subjectSubdoc._id  // Use the subdocument's _id (now exists after save)
            });
            slotsAdded++;
            console.log(`      ✅ ADDED: ${dayData.day} ${slot.startTime}-${slot.endTime} → ${matchingSubject.code}`);
          } else {
            console.log(`      ❌ FAILED: Subdocument not found or missing _id`);
            skippedSlots.push(`${dayData.day} ${slot.startTime}-${slot.endTime}: ${slot.subjectCode} (subdoc not found)`);
          }
        } else {
          console.log(`      ❌ FAILED: No matching subject found`);
          skippedSlots.push(`${dayData.day} ${slot.startTime}-${slot.endTime}: ${slot.subjectCode} (no match)`);
        }
      }
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Slots successfully added: ${slotsAdded}`);
    console.log(`   ❌ Skipped slots: ${skippedSlots.length}`);
    if (skippedSlots.length > 0) {
      console.log(`   Skipped details:`);
      skippedSlots.forEach(s => console.log(`      - ${s}`));
    }
    
    console.log(`\n💾 Saving schedule with ${slotsAdded} time slots...`);
    await schedule.save();
    console.log('✅ Schedule saved to database');
    
    // Success message
    let successMsg = `✅ *Schedule Created Successfully!*\n\n` +
      `📚 Subjects (${subjectsData.subjects.length}):\n` +
      subjectsData.subjects.map(s => `• ${s.code} - ${s.name}`).join('\n') +
      `\n\n📅 Time slots: ${slotsAdded}`;
    
    if (skippedSlots.length > 0) {
      successMsg += `\n⚠️  Skipped ${skippedSlots.length} slots (subject code mismatch)`;
    }
    
    successMsg += `\n\n🎉 You can now start reporting your attendance!\n\n` +
      `💡 Example: "I attended ${subjectsData.subjects[0]?.code || 'CS101'} and ${subjectsData.subjects[1]?.code || 'MA101'} today"`;
    
    await whatsappService.sendMessage(phoneNumber, successMsg);
    
    // Clear upload state
    student.uploadState = null;
    await student.save();
    
  } catch (error) {
    console.error('❌ Error in processCompleteSchedule:', error);
    console.error('   Stack:', error.stack);
    
    await whatsappService.sendMessage(
      phoneNumber,
      '😔 Sorry, I had trouble processing your schedule images.\n\n' +
      '🔄 Please try uploading again.\n\n' +
      `Error: ${error.message}`
    );
    
    throw error;
  }
}

/**
 * Handle image messages (schedule upload)
 */
async function handleImageMessage(student, phoneNumber, message) {
  try {
    console.log('📸 Processing schedule image...');
    
    // Initialize student's upload state if not exists
    if (!student.uploadState) {
      student.uploadState = {
        subjectListImage: null,
        scheduleImage: null,
        step: 'waiting_first_image'
      };
    }

    await whatsappService.sendMessage(
      phoneNumber,
      '📸 Image received! Let me know what this is:\n\n' +
      '1️⃣ Type "subject list" if this contains subject names and codes\n' +
      '2️⃣ Type "schedule" if this is your timetable with subject codes\n\n' +
      '💡 I need both images to create your complete schedule!'
    );

    // Store the image ID temporarily (you'll need to download and process later)
    student.lastImageId = message.image.id;
    student.lastImageCaption = message.image.caption || '';
    await student.save();

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

// Error handling middleware (must be last)
app.use((err, req, res, next) => {
  monitoringService.trackError(err);
  console.error('💥 Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
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

module.exports = app;
