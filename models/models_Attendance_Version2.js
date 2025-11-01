const mongoose = require('mongoose');

const AttendanceRecordSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    index: true
  },
  subjectCode: {
    type: String,
    required: true
  },
  subjectName: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['PRESENT', 'ABSENT', 'CANCELLED', 'HOLIDAY'],
    required: true
  },
  timeSlot: {
    type: String,
    default: 'general'
  },
  notes: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Compound index for unique constraint: one record per phone+subject+date+timeSlot
AttendanceRecordSchema.index({ phoneNumber: 1, subjectCode: 1, date: 1, timeSlot: 1 }, { unique: true });

module.exports = mongoose.model('AttendanceRecord', AttendanceRecordSchema);