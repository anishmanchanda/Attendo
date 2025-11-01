require('dotenv').config();
const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
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

async function checkSchedules() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    const Student = mongoose.model('Student', new mongoose.Schema({
      phoneNumber: String,
      name: String,
      rollNumber: String
    }));
    
    const student = await Student.findOne({ phoneNumber: '917428912104' });
    console.log('Student:', student._id, '-', student.name);
    console.log('\n=== ALL SCHEDULES FOR THIS STUDENT ===\n');
    
    const schedules = await Schedule.find({ student: student._id }).sort({ createdAt: -1 });
    
    schedules.forEach((sched, idx) => {
      console.log(`Schedule ${idx + 1}:`);
      console.log(`  _id: ${sched._id}`);
      console.log(`  Created: ${sched.createdAt}`);
      console.log(`  Subjects: ${sched.subjects.length}`);
      console.log(`  TimeSlots: ${sched.timeSlots.length}`);
      console.log('');
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkSchedules();
