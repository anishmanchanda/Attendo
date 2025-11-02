require('dotenv').config();
const mongoose = require('mongoose');
const AttendanceRecord = require('../models/models_Attendance_Version2');
const { Schedule } = require('../models/models_Schedule_Version2');
const Student = require('../models/models_Student_Version2');

async function setupIndexes() {
  try {
    console.log('🔧 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log('📋 Setting up indexes...\n');

    // Drop old indexes
    console.log('1️⃣  Dropping old indexes...');
    try {
      await AttendanceRecord.collection.dropIndex('phoneNumber_1_subjectCode_1_date_1');
      console.log('   ✅ Dropped old attendance index');
    } catch (e) {
      console.log('   ℹ️  Old index not found (OK)');
    }

    // Create new indexes
    console.log('\n2️⃣  Creating new indexes...');
    await AttendanceRecord.syncIndexes();
    console.log('   ✅ Attendance indexes created');

    await Schedule.syncIndexes();
    console.log('   ✅ Schedule indexes created');

    await Student.syncIndexes();
    console.log('   ✅ Student indexes created');

    // Verify indexes
    console.log('\n3️⃣  Verifying indexes...');
    const attendanceIndexes = await AttendanceRecord.collection.getIndexes();
    console.log('   Attendance indexes:', Object.keys(attendanceIndexes).join(', '));

    const scheduleIndexes = await Schedule.collection.getIndexes();
    console.log('   Schedule indexes:', Object.keys(scheduleIndexes).join(', '));

    const studentIndexes = await Student.collection.getIndexes();
    console.log('   Student indexes:', Object.keys(studentIndexes).join(', '));

    console.log('\n✅ All indexes setup successfully!');
    console.log('\n📊 Database is now optimized for 100+ users');
    
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error setting up indexes:', error);
    process.exit(1);
  }
}

setupIndexes();
