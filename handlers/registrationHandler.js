const Student = require('../models/models_Student_Version2');
const { Schedule } = require('../models/models_Schedule_Version2');

/**
 * Handle student registration
 * This is the FIRST STEP - enforced for all new users
 */
async function handleRegistration(student, phoneNumber, aiResponse, whatsappService) {
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

    // If fully registered, prompt for schedule upload
    if (student.isRegistered) {
      const schedule = await Schedule.findOne({ student: student._id });
      if (!schedule) {
        setTimeout(async () => {
          await whatsappService.sendMessage(
            phoneNumber,
            '🎉 *Registration Complete!*\n\n' +
            '📸 *Next Step: Upload Your Schedule*\n\n' +
            'Please send TWO images:\n' +
            '1️⃣ Subject list (with subject codes and names)\n' +
            '2️⃣ Your class timetable\n\n' +
            'After each image, tell me:\n' +
            '• "subject list" for the first one\n' +
            '• "schedule" for the timetable\n\n' +
            '💡 Make sure images are clear and readable!'
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
 * Check if a student needs to complete registration
 */
function needsRegistration(student) {
  return !student.isRegistered || !student.name || !student.rollNumber;
}

/**
 * Get welcome message for new users
 */
function getWelcomeMessage() {
  return '👋 *Welcome to the Attendance Bot!*\n\n' +
    '✨ I help you track your class attendance automatically.\n\n' +
    '📝 *Step 1: Registration (Required)*\n' +
    'Tell me your name and roll number to get started.\n\n' +
    '💡 *Example:*\n' +
    '"My name is John Doe and my roll number is 12345"\n\n' +
    '⏩ What\'s your name and roll number?';
}

/**
 * Get registration reminder message
 */
function getRegistrationReminder(student) {
  if (!student.name || student.name === 'New User') {
    return '⚠️ *Registration Required*\n\n' +
      'Please complete your registration first!\n\n' +
      'Tell me your name and roll number.\n\n' +
      '💡 Example: "My name is John and roll number is 12345"';
  }
  
  if (!student.rollNumber) {
    return '⚠️ *Roll Number Required*\n\n' +
      `Hi ${student.name}! I still need your roll number to complete registration.\n\n` +
      '💡 Example: "My roll number is 12345"';
  }

  return '⚠️ *Registration Incomplete*\n\n' +
    'Please provide your name and roll number to continue.\n\n' +
    '💡 Example: "My name is John Doe and roll number is 12345"';
}

module.exports = {
  handleRegistration,
  needsRegistration,
  getWelcomeMessage,
  getRegistrationReminder
};
