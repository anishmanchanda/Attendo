const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    index: true
  },
  date: {
    type: Date,
    required: true,
    index: true
  },
  subjectCode: {
    type: String,
    required: true,
    index: true
  },
  subjectName: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['PRESENT', 'ABSENT', 'HOLIDAY', 'CANCELLED'],
    default: 'PRESENT'
  },
  timeSlot: {
    type: String,
    required: true,
    default: 'general'
  },
  notes: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Compound unique index to prevent duplicate attendance records
attendanceSchema.index({ phoneNumber: 1, subjectCode: 1, date: 1, timeSlot: 1 }, { unique: true });

// Compound indexes for efficient queries
attendanceSchema.index({ phoneNumber: 1, date: 1 });
attendanceSchema.index({ phoneNumber: 1, subjectCode: 1 });
attendanceSchema.index({ phoneNumber: 1, status: 1 });

// Update updatedAt on save
attendanceSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Attendance', attendanceSchema);