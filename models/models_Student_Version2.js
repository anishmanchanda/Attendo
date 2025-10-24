const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    unique: true
  },
  rollNumber: {
    type: String,
    required: false,  // Optional - will be set during registration
    unique: true,
    sparse: true  // Allows multiple null values
  },
  name: {
    type: String,
    required: false,  // Optional - will be set during registration
    default: 'New User'
  },
  semester: {
    type: Number,
    required: false  // Optional - will be set during registration
  },
  isRegistered: {
    type: Boolean,
    default: false
  },
  registrationDate: {
    type: Date,
    default: Date.now
  },
  subjects: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject'
  }],
  chatState: {
    type: String,
    enum: ['IDLE', 'AWAITING_SCHEDULE', 'AWAITING_ATTENDANCE', 'AWAITING_CONFIRMATION'],
    default: 'IDLE'
  },
  tempData: {
    type: mongoose.Schema.Types.Mixed
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Student', StudentSchema);