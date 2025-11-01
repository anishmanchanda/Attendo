require('dotenv').config();
const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
  student: mongoose.Schema.Types.ObjectId,
  semester: Number,
  subjects: [{
    code: String,
    name: String,
    totalClasses: { type: Number, default: 0 }
  }],
  timeSlots: [{
    day: String,
    startTime: String,
    endTime: String,
    subject: mongoose.Schema.Types.ObjectId
  }]
}, { timestamps: true });

const Schedule = mongoose.model('Schedule', scheduleSchema);

const studentSchema = new mongoose.Schema({
  phoneNumber: String,
  name: String,
  rollNumber: String
});

const Student = mongoose.model('Student', studentSchema);

async function resetClassCounts() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    const student = await Student.findOne({ phoneNumber: '917428912104' });
    const schedule = await Schedule.findOne({ student: student._id }).sort({ createdAt: -1 });
    
    console.log('Current totalClasses counts:');
    schedule.subjects.forEach(s => {
      console.log(`  ${s.code}: ${s.totalClasses}`);
    });
    
    console.log('\nResetting all to 0...');
    schedule.subjects.forEach(s => {
      s.totalClasses = 0;
    });
    
    await schedule.save();
    console.log('✅ Reset complete!');
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

resetClassCounts();
