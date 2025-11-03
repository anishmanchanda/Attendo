const attendanceService = require('../services/services_attendanceService_Version2');
const { Schedule } = require('../models/models_Schedule_Version2');

/**
 * Handle attendance recording
 */
async function handleAttendanceRecording(student, phoneNumber, aiResponse, messageId, whatsappService) {
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
    
    // Send reaction if messageId is available
    if (messageId) {
      await whatsappService.sendReaction(phoneNumber, messageId, '✅');
    }

  } catch (error) {
    console.error('Error in handleAttendanceRecording:', error);
    throw error;
  }
}

/**
 * Handle attendance summary request
 */
async function handleSummaryRequest(student, phoneNumber, whatsappService) {
  try {
    const summary = await attendanceService.getAttendanceSummary(student._id);
    
    if (!summary || !summary.subjects || summary.subjects.length === 0) {
      await whatsappService.sendMessage(
        phoneNumber,
        '📊 *Attendance Summary*\n\n' +
        'No attendance records found yet.\n\n' +
        '💡 Start marking your attendance by telling me which classes you attended!\n\n' +
        '📝 *Example:*\n"I attended Math and Physics today"'
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
    message += '\n💡 *Tip:* You need 75% attendance to stay in good standing!';

    await whatsappService.sendMessage(phoneNumber, message);

  } catch (error) {
    console.error('Error in handleSummaryRequest:', error);
    throw error;
  }
}

/**
 * Handle modifying attendance based on AI extraction
 */
async function handleModifyAttendance(student, phoneNumber, aiResponse, whatsappService) {
  try {
    const { subjectCode, date, status } = aiResponse;

    if (!subjectCode || !date || !status) {
      await whatsappService.sendMessage(
        phoneNumber,
        '❓ Please specify:\n• Subject code (e.g., PC-209)\n• Date (YYYY-MM-DD or natural language)\n• Status (present or absent)\n\nExample: "Mark me present for PC-209 on 2025-10-27"'
      );
      return;
    }

    const result = await attendanceService.modifyAttendance(student._id, {
      subjectCode,
      date,
      status
    });

    await whatsappService.sendMessage(
      phoneNumber,
      `✅ Updated ${result.updated} record(s) for ${result.subject} on ${result.day}, ${result.date}\nStatus: ${status.toUpperCase()}\n\n💡 You can check with "show my attendance"`
    );
  } catch (error) {
    console.error('Error in handleModifyAttendance:', error);
    await whatsappService.sendMessage(
      phoneNumber,
      `😔 Couldn't modify attendance: ${error.message}`
    );
  }
}

/**
 * Handle viewing schedule for a specific day
 */
async function handleViewSchedule(student, phoneNumber, aiResponse, whatsappService) {
  try {
    // Normalize the day name: capitalize first letter, lowercase rest
    let requestedDay = aiResponse.day || new Date().toLocaleDateString('en-US', { weekday: 'long' });
    requestedDay = requestedDay.charAt(0).toUpperCase() + requestedDay.slice(1).toLowerCase();
    
    console.log(`📅 Fetching schedule for ${requestedDay}`);
    
    // Get student's schedule
    const schedule = await Schedule.findOne({ student: student._id });
    
    if (!schedule) {
      await whatsappService.sendMessage(
        phoneNumber,
        '📅 *Schedule Not Found*\n\n' +
        'You haven\'t uploaded your schedule yet!\n\n' +
        '📸 Please send your timetable images to get started.'
      );
      return;
    }
    
    console.log(`📋 Schedule found with ${schedule.subjects.length} subjects and ${schedule.timeSlots.length} time slots`);
    console.log(`📋 Available days: ${[...new Set(schedule.timeSlots.map(s => s.day))].join(', ')}`);
    
    // Filter time slots for the requested day (case-insensitive comparison)
    const daySlots = schedule.timeSlots.filter(slot => 
      slot.day.toLowerCase() === requestedDay.toLowerCase()
    );
    
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
      const subject = schedule.subjects.find(s => s._id.toString() === slot.subject.toString());
      
      if (subject) {
        message += `🕐 *${slot.startTime} - ${slot.endTime}*\n`;
        message += `   📚 ${subject.code} - ${subject.name}\n\n`;
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

module.exports = {
  handleAttendanceRecording,
  handleSummaryRequest,
  handleViewSchedule,
  handleModifyAttendance
};
