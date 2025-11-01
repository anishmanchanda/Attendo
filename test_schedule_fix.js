/**
 * Test script to verify schedule time slots are saved correctly
 * Run: node test_schedule_fix.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { Schedule } = require('./models/models_Schedule_Version2');

async function testSchedule() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find a schedule (get the most recent one)
    const schedule = await Schedule.findOne().sort({ createdAt: -1 });
    
    if (!schedule) {
      console.log('❌ No schedules found in database');
      process.exit(0);
    }

    console.log('\n📊 Schedule Analysis:');
    console.log('='.repeat(50));
    console.log(`Student ID: ${schedule.student}`);
    console.log(`Semester: ${schedule.semester}`);
    console.log(`\n📚 Subjects (${schedule.subjects.length}):`);
    
    schedule.subjects.forEach((subject, index) => {
      console.log(`${index + 1}. ${subject.code} - ${subject.name}`);
      console.log(`   ID: ${subject._id}`);
    });

    console.log(`\n📅 Time Slots (${schedule.timeSlots.length}):`);
    
    if (schedule.timeSlots.length === 0) {
      console.log('❌ NO TIME SLOTS FOUND! This is the bug.');
    } else {
      // Group by day
      const slotsByDay = {};
      schedule.timeSlots.forEach(slot => {
        if (!slotsByDay[slot.day]) {
          slotsByDay[slot.day] = [];
        }
        slotsByDay[slot.day].push(slot);
      });

      Object.keys(slotsByDay).sort().forEach(day => {
        console.log(`\n${day}:`);
        slotsByDay[day].forEach(slot => {
          const subject = schedule.subjects.find(s => s._id.toString() === slot.subject.toString());
          console.log(`  ${slot.startTime}-${slot.endTime}: ${subject?.code || 'Unknown'} (${subject?.name || 'N/A'})`);
        });
      });

      console.log('\n✅ Time slots are properly saved!');
    }

    console.log('\n' + '='.repeat(50));

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

testSchedule();
