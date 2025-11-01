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
 * Handle viewing schedule for a specific day
 */
async function handleViewSchedule(student, phoneNumber, aiResponse, whatsappService) {
  try {
    const requestedDay = aiResponse.day || new Date().toLocaleDateString('en-US', { weekday: 'long' });
    
    console.log(`📅 Fetching schedule for ${requestedDay}`);
    
    // Get student's schedule
    const schedule = await Schedule.findOne({ student: student._id }).populate('subjects');
    
    if (!schedule) {
      await whatsappService.sendMessage(
        phoneNumber,
        '📅 *Schedule Not Found*\n\n' +
        'You haven\'t uploaded your schedule yet!\n\n' +
        '📸 Please send your timetable images to get started.'
      );
      return;
    }
    
    // Filter time slots for the requested day
    const daySlots = schedule.timeSlots.filter(slot => slot.day === requestedDay);
    
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
  handleViewSchedule
};
