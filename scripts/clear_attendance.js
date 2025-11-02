require('dotenv').config();
const mongoose = require('mongoose');

const AttendanceRecordSchema = new mongoose.Schema({
  phoneNumber: String,
  subjectCode: String,
  subjectName: String,
  date: Date,
  status: String,
  notes: String,
  createdAt: Date
});

const AttendanceRecord = mongoose.model('AttendanceRecord', AttendanceRecordSchema);

async function clearAttendance() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    const phoneNumber = '917428912104';
    
    // Get all attendance records for this user
    const records = await AttendanceRecord.find({ phoneNumber });
    console.log(`Found ${records.length} attendance records for ${phoneNumber}\n`);
    
    if (records.length > 0) {
      console.log('Existing records:');
      records.forEach(r => {
        console.log(`  ${r.date.toISOString().split('T')[0]} - ${r.subjectCode} - ${r.status}`);
      });
      
      console.log('\nDeleting all attendance records...');
      const result = await AttendanceRecord.deleteMany({ phoneNumber });
      console.log(`✅ Deleted ${result.deletedCount} records`);
    } else {
      console.log('No attendance records found.');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

clearAttendance();
