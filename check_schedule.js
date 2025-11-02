require('dotenv').config();
const mongoose = require('mongoose');
const { Schedule } = require('./models/models_Schedule_Version2');
const Student = require('./models/models_Student_Version2');

async function checkSchedule() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const student = await Student.findOne({ phoneNumber: '917428912104' });
    if (!student) {
      console.log('Student not found');
      return;
    }
    console.log('Found student:', student._id, '\n');

    const schedule = await Schedule.findOne({ student: student._id }).sort({ createdAt: -1 });
    
    if (!schedule) {
      console.log('No schedule found');
      return;
    }

    console.log('📅 Schedule Time Slots by Day:\n');
    
    // Group by day
    const dayGroups = {};
    schedule.timeSlots.forEach(slot => {
      if (!dayGroups[slot.day]) {
        dayGroups[slot.day] = [];
      }
      dayGroups[slot.day].push(slot);
    });

    // Display by day
    Object.keys(dayGroups).sort().forEach(day => {
      console.log(`\n${day}:`);
      dayGroups[day].forEach(slot => {
        console.log(`  ${slot.startTime}-${slot.endTime} - Subject: ${slot.subject}`);
      });
    });

    console.log('\n\n📚 Subjects:');
    schedule.subjects.forEach(subject => {
      console.log(`  ${subject.code} - ${subject.name} (Total Classes: ${subject.totalClasses})`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Done!');
  }
}

checkSchedule();
