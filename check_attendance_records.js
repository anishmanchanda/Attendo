require('dotenv').config();
const mongoose = require('mongoose');

const AttendanceRecordSchema = new mongoose.Schema({
  phoneNumber: String,
  subjectCode: String,
  subjectName: String,
  date: Date,
  status: String,
  timeSlot: String,
  notes: String,
  createdAt: Date
});

const AttendanceRecord = mongoose.model('AttendanceRecord', AttendanceRecordSchema);

async function checkRecords() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const phoneNumber = '917428912104';
    
    const records = await AttendanceRecord.find({ phoneNumber }).sort({ date: 1, timeSlot: 1 });
    
    console.log(`Found ${records.length} attendance records:\n`);
    
    records.forEach(r => {
      const date = r.date.toISOString().split('T')[0];
      const day = r.date.toLocaleDateString('en-US', { weekday: 'long' });
      console.log(`📅 ${date} (${day})`);
      console.log(`   📚 Subject: ${r.subjectCode} - ${r.subjectName}`);
      console.log(`   🕐 Time Slot: ${r.timeSlot}`);
      console.log(`   ✓ Status: ${r.status}`);
      console.log(`   📝 Created: ${r.createdAt.toLocaleString()}`);
      console.log('');
    });
    
    // Group by subject
    const bySubject = {};
    records.forEach(r => {
      if (!bySubject[r.subjectCode]) {
        bySubject[r.subjectCode] = [];
      }
      bySubject[r.subjectCode].push(r);
    });
    
    console.log('\n📊 Summary by Subject:');
    Object.keys(bySubject).forEach(code => {
      const subjectRecords = bySubject[code];
      const present = subjectRecords.filter(r => r.status === 'PRESENT').length;
      const absent = subjectRecords.filter(r => r.status === 'ABSENT').length;
      console.log(`\n${code}:`);
      console.log(`  ✅ Present: ${present}`);
      console.log(`  ❌ Absent: ${absent}`);
      console.log(`  📝 Total Records: ${subjectRecords.length}`);
    });
    
    await mongoose.disconnect();
    console.log('\n✅ Done!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkRecords();
