const { Schedule } = require('../models/models_Schedule_Version2');

/**
 * Check if a student needs to upload their schedule
 */
async function needsSchedule(student) {
  const schedule = await Schedule.findOne({ student: student._id });
  return !schedule || !schedule.subjects || schedule.subjects.length === 0;
}

/**
 * Get schedule upload prompt message
 */
function getScheduleUploadPrompt() {
  return '📸 *Upload Your Class Schedule*\n\n' +
    'Please send TWO images:\n\n' +
    '1️⃣ *Subject List* - Contains subject codes and names\n' +
    '2️⃣ *Timetable* - Your weekly class schedule\n\n' +
    '📝 After sending each image, reply with:\n' +
    '• Type "subject list" for the first image\n' +
    '• Type "schedule" for the timetable\n\n' +
    '💡 Tip: Make sure images are clear and well-lit!';
}

/**
 * Get schedule required reminder
 */
function getScheduleRequiredMessage() {
  return '⚠️ *Schedule Upload Required*\n\n' +
    'Before marking attendance, I need your class schedule!\n\n' +
    '📸 Please upload TWO images:\n' +
    '1️⃣ Subject list (codes and names)\n' +
    '2️⃣ Your timetable\n\n' +
    'After each image, tell me:\n' +
    '• "subject list" or\n' +
    '• "schedule"\n\n' +
    '✨ Then you can start tracking attendance!';
}

/**
 * Handle image messages (schedule upload)
 */
async function handleImageMessage(student, phoneNumber, message, whatsappService) {
  try {
    console.log('📸 Processing schedule image...');
    
    // Initialize student's upload state if not exists
    if (!student.uploadState) {
      student.uploadState = {
        subjectListImageId: null,
        scheduleImageId: null,
        step: 'waiting_first_image'
      };
    }

    await whatsappService.sendMessage(
      phoneNumber,
      '📸 *Image Received!*\n\n' +
      'What does this image contain?\n\n' +
      '1️⃣ Type "*subject list*" if this shows subject names and codes\n' +
      '2️⃣ Type "*schedule*" if this is your weekly timetable\n\n' +
      '💡 I need both images to set up your attendance tracking!'
    );

    // Store the image ID temporarily
    student.lastImageId = message.image.id;
    student.lastImageCaption = message.image.caption || '';
    await student.save();

  } catch (error) {
    console.error('Error in handleImageMessage:', error);
    throw error;
  }
}

/**
 * Handle image classification (subject list vs schedule)
 */
async function handleImageClassification(student, phoneNumber, text, whatsappService, aiService) {
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
        '✅ *Subject list saved!*\n\n' +
        '📸 Now send your *timetable* image and reply with "schedule"'
      );
      
    } else if (lowerText.includes('schedule')) {
      student.uploadState.scheduleImageId = student.lastImageId;
      student.lastImageId = null;
      await student.save();
      
      // Check if we have both images
      if (student.uploadState.subjectListImageId && student.uploadState.scheduleImageId) {
        await processCompleteSchedule(student, phoneNumber, whatsappService, aiService);
      } else {
        await whatsappService.sendMessage(
          phoneNumber,
          '✅ *Timetable saved!*\n\n' +
          '📸 Now send your *subject list* image and reply with "subject list"'
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
async function processCompleteSchedule(student, phoneNumber, whatsappService, aiService) {
  try {
    await whatsappService.sendMessage(
      phoneNumber,
      '🎉 *Both images received!*\n\n' +
      '🤖 Using GPT-4 Vision to extract your schedule...\n\n' +
      '⏳ This may take 10-20 seconds. Please wait!'
    );
    
    // Get WhatsApp media URLs for both images
    const subjectListUrl = await whatsappService.getMediaUrl(student.uploadState.subjectListImageId);
    const scheduleUrl = await whatsappService.getMediaUrl(student.uploadState.scheduleImageId);
    
    console.log('📸 Extracting subject list from image...');
    const subjectsData = await aiService.extractScheduleFromImage(subjectListUrl, 'subject_list');
    
    console.log('📸 Extracting timetable from image...');
    const scheduleData = await aiService.extractScheduleFromImage(scheduleUrl, 'schedule');
    
    console.log('✅ GPT-4 Vision Response:');
    console.log('   Subjects:', JSON.stringify(subjectsData, null, 2));
    console.log('   Schedule:', JSON.stringify(scheduleData, null, 2));
    
    // Validate extracted data
    if (!subjectsData?.subjects || subjectsData.subjects.length === 0) {
      throw new Error('No subjects extracted from subject list image');
    }
    
    if (!scheduleData?.schedule || scheduleData.schedule.length === 0) {
      throw new Error('No schedule data extracted from timetable image');
    }
    
    // Create a map for quick subject code lookup
    const normalizeCode = (code) => code.replace(/[-\s]/g, '').toUpperCase();
    const subjectMap = new Map();
    subjectsData.subjects.forEach(s => {
      const normalized = normalizeCode(s.code);
      subjectMap.set(normalized, s);
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
    console.log('✅ Schedule document created with subject subdocuments');
    
    // Add time slots from schedule
    let slotsAdded = 0;
    let skippedSlots = [];
    
    for (const dayData of scheduleData.schedule) {
      console.log(`\n📅 Processing ${dayData.day}:`, dayData.slots?.length || 0, 'slots');
      
      if (!dayData.slots || dayData.slots.length === 0) {
        console.log(`   ⚠️  No slots found for ${dayData.day}`);
        continue;
      }
      
      for (const slot of dayData.slots) {
        let baseCode = slot.subjectCode.split('/')[0].trim();
        const normalizedSlotCode = normalizeCode(baseCode);
        
        // Try multiple matching strategies
        let matchingSubject = subjectMap.get(slot.subjectCode) ||
                             subjectMap.get(baseCode) ||
                             subjectMap.get(normalizedSlotCode);
        
        // Search for partial matches
        if (!matchingSubject) {
          for (const [key, subject] of subjectMap.entries()) {
            const normalizedKey = normalizeCode(key);
            if (normalizedKey === normalizedSlotCode || 
                normalizedKey.includes(normalizedSlotCode) || 
                normalizedSlotCode.includes(normalizedKey)) {
              matchingSubject = subject;
              console.log(`   🔍 Found match: "${slot.subjectCode}" -> "${subject.code}"`);
              break;
            }
          }
        }
        
        if (matchingSubject) {
          const subjectSubdoc = schedule.subjects.find(s => 
            normalizeCode(s.code) === normalizeCode(matchingSubject.code)
          );
          
          if (subjectSubdoc && subjectSubdoc._id) {
            schedule.timeSlots.push({
              day: dayData.day,
              startTime: slot.startTime,
              endTime: slot.endTime,
              subject: subjectSubdoc._id  // Now exists after first save
            });
            slotsAdded++;
            console.log(`   ✅ ${slot.startTime}-${slot.endTime} → ${slot.subjectCode}`);
          } else {
            console.log(`   ⚠️  Subdocument not found or missing _id for ${matchingSubject.code}`);
            skippedSlots.push(`${dayData.day} ${slot.startTime}-${slot.endTime}: ${slot.subjectCode}`);
          }
        } else {
          console.log(`   ❌ No match found for "${slot.subjectCode}"`);
          skippedSlots.push(`${dayData.day} ${slot.startTime}-${slot.endTime}: ${slot.subjectCode}`);
        }
      }
    }
    
    console.log(`\n📊 Summary: ✅ ${slotsAdded} slots added, ❌ ${skippedSlots.length} skipped`);
    
    // Save schedule again with time slots added
    await schedule.save();
    console.log('✅ Schedule with time slots saved to database');
    
    // Success message
    let successMsg = `✅ *Schedule Created Successfully!*\n\n` +
      `📚 *Subjects (${subjectsData.subjects.length}):*\n` +
      subjectsData.subjects.map(s => `• ${s.code} - ${s.name}`).join('\n') +
      `\n\n📅 *Time slots:* ${slotsAdded}`;
    
    if (skippedSlots.length > 0) {
      successMsg += `\n⚠️  Skipped ${skippedSlots.length} slots (subject code mismatch)`;
    }
    
    successMsg += `\n\n🎉 *You're all set!*\n\n` +
      `Now you can start marking your attendance!\n\n` +
      `💡 *Example:*\n"I attended ${subjectsData.subjects[0]?.code || 'CS101'} and ${subjectsData.subjects[1]?.code || 'MA101'} today"`;
    
    await whatsappService.sendMessage(phoneNumber, successMsg);
    
    // Clear upload state
    student.uploadState = null;
    await student.save();
    
  } catch (error) {
    console.error('❌ Error in processCompleteSchedule:', error);
    
    await whatsappService.sendMessage(
      phoneNumber,
      '😔 Sorry, I had trouble processing your schedule images.\n\n' +
      '🔄 Please try uploading again.\n\n' +
      `Error: ${error.message}`
    );
    
    throw error;
  }
}

module.exports = {
  needsSchedule,
  getScheduleUploadPrompt,
  getScheduleRequiredMessage,
  handleImageMessage,
  handleImageClassification,
  processCompleteSchedule
};
