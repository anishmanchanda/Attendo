const Student = require('../models/models_Student_Version2');
const { Schedule, Subject } = require('../models/models_Schedule_Version2');
const AttendanceRecord = require('../models/models_Attendance_Version2');
const moment = require('moment');

class AttendanceService {
  async registerStudent(phoneNumber, studentData) {
    try {
      // Check if student already exists
      let student = await Student.findOne({ phoneNumber });
      
      if (student) {
        // Update existing student
        student.rollNumber = studentData.rollNumber;
        student.name = studentData.name || student.name;
        student.semester = studentData.semester;
        await student.save();
      } else {
        // Create new student
        student = new Student({
          phoneNumber,
          rollNumber: studentData.rollNumber,
          name: studentData.name || 'Student',
          semester: studentData.semester,
          subjects: []
        });
        await student.save();
      }
      
      // Create or update schedule
      await this.updateStudentSchedule(student._id, studentData);
      
      return student;
    } catch (error) {
      console.error('Error registering student:', error);
      throw error;
    }
  }

  async updateStudentSchedule(studentId, scheduleData) {
    try {
      // Delete existing schedule if any
      await Schedule.deleteMany({ student: studentId });
      
      // Create subjects
      const subjectDocs = [];
      for (const subjectData of scheduleData.subjects) {
        const subject = new Subject({
          code: subjectData.code,
          name: subjectData.name
        });
        
        subjectDocs.push({
          model: subject,
          code: subject.code
        });
      }
      
      // Create schedule with time slots
      const schedule = new Schedule({
        student: studentId,
        semester: scheduleData.semester,
        subjects: subjectDocs.map(s => s.model),
        timeSlots: []
      });
      
      // Add time slots
      for (const dayData of scheduleData.schedule) {
        for (const slotData of dayData.slots) {
          const subjectDoc = subjectDocs.find(s => s.code === slotData.subject);
          
          if (subjectDoc) {
            schedule.timeSlots.push({
              day: dayData.day,
              startTime: slotData.startTime,
              endTime: slotData.endTime,
              subject: subjectDoc.model._id
            });
          }
        }
      }
      
      await schedule.save();
      return schedule;
    } catch (error) {
      console.error('Error updating student schedule:', error);
      throw error;
    }
  }

  async recordAttendance(studentId, attendanceData) {
    try {
      const date = moment(attendanceData.date).startOf('day').toDate();
      
      // If it's a holiday, mark all subjects as HOLIDAY
      if (attendanceData.isHoliday) {
        const schedule = await Schedule.findOne({ student: studentId });
        const subjects = [...new Set(schedule.timeSlots
          .filter(slot => slot.day === moment(date).format('dddd'))
          .map(slot => slot.subject.toString()))];
          
        // Delete any existing records for this date
        await AttendanceRecord.deleteMany({
          student: studentId,
          date: {
            $gte: date,
            $lt: moment(date).add(1, 'days').toDate()
          }
        });
        
        // Create holiday records
        const records = subjects.map(subjectId => ({
          student: studentId,
          subject: subjectId,
          date,
          status: 'HOLIDAY',
          notes: 'Holiday reported by student'
        }));
        
        await AttendanceRecord.insertMany(records);
        return records;
      }
      
      // Regular attendance recording
      const records = [];
      for (const entry of attendanceData.attendance) {
        // Find the subject
        const schedule = await Schedule.findOne({ student: studentId })
          .populate('subjects');
          
        const subject = schedule.subjects.find(s => s.code === entry.subjectCode);
        
        if (!subject) continue;
        
        // Delete any existing record for this subject on this date
        await AttendanceRecord.deleteOne({
          student: studentId,
          subject: subject._id,
          date: {
            $gte: date,
            $lt: moment(date).add(1, 'days').toDate()
          }
        });
        
        // Create new attendance record
        const record = new AttendanceRecord({
          student: studentId,
          subject: subject._id,
          date,
          status: entry.status,
          notes: entry.notes || ''
        });
        
        await record.save();
        records.push(record);
        
        // Update total classes count if not cancelled
        if (entry.status !== 'CANCELLED') {
          subject.totalClasses += 1;
          await subject.save();
        }
      }
      
      return records;
    } catch (error) {
      console.error('Error recording attendance:', error);
      throw error;
    }
  }

  async getAttendanceSummary(studentId) {
    try {
      // Get student schedule with subjects
      const schedule = await Schedule.findOne({ student: studentId })
        .populate('subjects');
        
      if (!schedule) {
        // Return empty summary if no schedule exists
        return {
          overall: {
            present: 0,
            total: 0,
            percentage: 'N/A'
          },
          subjects: []
        };
      }
      
      // Get attendance records
      const records = await AttendanceRecord.find({ student: studentId });
      
      // Calculate overall attendance
      const subjectsData = [];
      let totalClasses = 0;
      let totalPresent = 0;
      
      for (const subject of schedule.subjects) {
        const subjectRecords = records.filter(r => 
          r.subject.toString() === subject._id.toString() && 
          r.status !== 'CANCELLED' && 
          r.status !== 'HOLIDAY'
        );
        
        const presentCount = subjectRecords.filter(r => r.status === 'PRESENT').length;
        const totalCount = subject.totalClasses;
        
        const percentage = totalCount > 0 ? (presentCount / totalCount * 100).toFixed(2) : 'N/A';
        
        subjectsData.push({
          code: subject.code,
          name: subject.name,
          present: presentCount,
          total: totalCount,
          percentage: percentage
        });
        
        totalClasses += totalCount;
        totalPresent += presentCount;
      }
      
      const overallPercentage = totalClasses > 0 ? 
        (totalPresent / totalClasses * 100).toFixed(2) : 
        'N/A';
      
      return {
        overall: {
          present: totalPresent,
          total: totalClasses,
          percentage: overallPercentage
        },
        subjects: subjectsData
      };
    } catch (error) {
      console.error('Error getting attendance summary:', error);
      throw error;
    }
  }
}

module.exports = new AttendanceService();