# 🤖 WhatsApp Attendance Chatbot - Getting Started Guide

Welcome to your first big coding project! This guide will help you understand and run your attendance tracking chatbot.

## 🎯 What Your Bot Does

Your chatbot helps students:
- Upload their class schedules (via PDF or image)
- Report daily attendance via WhatsApp messages
- Get attendance summaries and subject-wise breakdowns
- Track attendance percentages automatically

## 🛠️ Setup Status

✅ **Database (MongoDB)**: Connected and working  
✅ **Core Logic**: Student registration, attendance tracking  
✅ **Error Handling**: Friendly error messages  
✅ **Test Mode**: All functionality verified  
⚠️ **WhatsApp Integration**: Needs OpenAI API key  
⚠️ **Document Processing**: Needs OpenAI API key  

## 🚀 Quick Start

### 1. Test Your Bot (Current Status)
```bash
cd /Users/anishmanchanda/Documents/GitHub/attendance-chatbot
node test_mode.js
```
Then visit: http://localhost:3000/test

### 2. Get WhatsApp Working
1. Get an OpenAI API key from [platform.openai.com](https://platform.openai.com/api-keys)
2. Update your `.env` file:
   ```
   OPENAI_API_KEY=your_actual_api_key_here
   ```
3. Start the full bot:
   ```bash
   npm start
   ```
4. Scan the QR code with WhatsApp

## 📱 How Students Will Use It

1. **First Time Setup**:
   - Student sends any message to your WhatsApp
   - Bot asks for their schedule (PDF/image)
   - Bot processes and saves their timetable

2. **Daily Attendance**:
   - Student: "I attended CS101 and MATH201 today"
   - Bot: Records attendance and confirms

3. **Check Stats**:
   - Student: "attendance" or "summary"
   - Bot: Shows overall and subject-wise percentages

## 🔧 Commands Your Bot Understands

- `help` - Show available commands
- `attendance` or `summary` - Show attendance stats
- `subjects` - Show subject-wise breakdown
- `reset` - Clear data and upload new schedule

## 📁 Project Structure

```
attendance-chatbot/
├── app_Version2.js          # Main application
├── test_mode.js             # Test without WhatsApp
├── start.js                 # Startup script with checks
├── config/
│   └── config_db_Version2.js # Database connection
├── models/                   # Data structures
│   ├── models_Student_Version2.js
│   ├── models_Attendance_Version2.js
│   └── models_Schedule_Version2.js
├── services/                 # Business logic
│   ├── services_whatsapp_Version1.js    # WhatsApp handling
│   ├── services_aiService_Version2.js   # OpenAI integration
│   ├── services_attendanceService_Version2.js
│   └── services_docProcessor_Version2.js
└── .env                     # Your secret keys and config
```

## 🚨 Common Issues & Solutions

### Issue: "WhatsApp client disconnected"
**Solution**: Restart the bot and scan QR code again

### Issue: "Document processing failed"
**Solution**: Make sure OpenAI API key is correct in `.env`

### Issue: "Database connection failed"
**Solution**: Make sure MongoDB is running:
```bash
brew services start mongodb/brew/mongodb-community
```

### Issue: Students report wrong attendance
**Solution**: Check the AI prompt in `services_aiService_Version2.js`

## 🎓 Learning Tips (Since This Is Your First Big Project!)

### Understanding the Flow:
1. **WhatsApp** → receives message
2. **Main App** → routes to correct handler
3. **Services** → process the logic
4. **Database** → stores the data
5. **WhatsApp** → sends response back

### Key Concepts You're Learning:
- **APIs**: Connecting to external services (OpenAI, WhatsApp)
- **Databases**: Storing and retrieving data with MongoDB
- **Node.js**: Server-side JavaScript
- **Express**: Web framework for handling requests
- **Environment Variables**: Keeping secrets safe

### Debugging Tips:
- Check console logs for error messages
- Use test mode to isolate problems
- Read error messages carefully - they usually tell you what's wrong!

## 🎯 Next Steps to Improve Your Bot

1. **Add More Commands**:
   - `today` - Show today's schedule
   - `week` - Show week's attendance
   - `missed` - Show classes with low attendance

2. **Better AI Understanding**:
   - Train it to understand different ways students say things
   - Add support for multiple languages

3. **Notifications**:
   - Remind students to mark attendance
   - Alert when attendance drops below 75%

4. **Web Dashboard**:
   - Create a website for teachers to view all students
   - Generate attendance reports

## 💡 Why This Project Is Awesome

You've built a real-world application that:
- Uses modern web technologies
- Integrates with multiple APIs
- Handles real user data
- Solves an actual problem students face
- Can be deployed and used by real people!

## 🆘 Need Help?

1. Check the console logs first
2. Try test mode to see if core functionality works
3. Make sure all environment variables are set
4. Verify MongoDB is running
5. Check that all npm packages are installed

Remember: Every programmer started with their first big project. You're doing great! 🌟

---

**Created by**: Anish Manchanda  
**Date**: October 2025  
**Project**: First Big Coding Adventure! 🚀