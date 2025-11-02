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
      let date = moment(attendanceData.date).startOf('day');
      
      // Get student to get phone number
      const student = await Student.findById(studentId);
      if (!student) throw new Error('Student not found');
      
      const phoneNumber = student.phoneNumber;
      
      // Get schedule first to validate against actual class days
      const schedule = await Schedule.findOne({ student: studentId }).sort({ createdAt: -1 });
      if (!schedule) throw new Error('Schedule not found');
      
      // If needsDayFilter is true, we need to validate the date matches the day
      if (attendanceData.needsDayFilter) {
        const actualDayOfWeek = date.format('dddd'); // Monday, Tuesday, etc.
        
        // Check if there are any classes scheduled on this day
        const classesOnThisDay = schedule.timeSlots.filter(slot => slot.day === actualDayOfWeek);
        
        if (classesOnThisDay.length === 0) {
          throw new Error(`No classes scheduled on ${actualDayOfWeek}. Please check your schedule.`);
        }
        
        console.log(`✅ Validated: ${date.format('YYYY-MM-DD')} is a ${actualDayOfWeek} with ${classesOnThisDay.length} classes`);
      }
      
      date = date.toDate();
      
      // If it's a holiday, mark all subjects as HOLIDAY
      if (attendanceData.isHoliday) {
        const schedule = await Schedule.findOne({ student: studentId }).sort({ createdAt: -1 });
        if (!schedule) throw new Error('Schedule not found');
        
        const uniqueSubjects = [...new Map(schedule.timeSlots
          .filter(slot => slot.day === moment(date).format('dddd'))
          .map(slot => {
            const subj = schedule.subjects.find(s => s._id.toString() === slot.subject.toString());
            return [subj.code, subj];
          })).values()];
          
        // Delete any existing records for this date
        await AttendanceRecord.deleteMany({
          phoneNumber: phoneNumber,
          date: {
            $gte: date,
            $lt: moment(date).add(1, 'days').toDate()
          }
        });
        
        // Create holiday records
        const records = uniqueSubjects.map(subject => ({
          phoneNumber: phoneNumber,
          subjectCode: subject.code,
          subjectName: subject.name,
          date,
          status: 'HOLIDAY',
          notes: 'Holiday reported by student'
        }));
        
        await AttendanceRecord.insertMany(records);
        return records;
      }
      
      // Regular attendance recording - schedule already fetched above
      // If needsDayFilter is true, get ALL time slots for that day
      if (attendanceData.needsDayFilter) {
        const dayOfWeek = moment(date).format('dddd'); // Monday, Tuesday, etc.
        console.log(`🗓️  Filtering attendance for ${dayOfWeek}'s classes only`);
        
        // Get ALL time slots for this day (not just unique subjects)
        const daySlots = schedule.timeSlots.filter(slot => slot.day === dayOfWeek);
        
        console.log(`   Found ${daySlots.length} time slots scheduled on ${dayOfWeek}`);
        
        // Override the attendance list with ALL time slots
        const defaultStatus = attendanceData.attendance.length > 0 ? attendanceData.attendance[0].status : 'PRESENT';
        attendanceData.attendance = daySlots.map(slot => {
          const subj = schedule.subjects.find(s => s._id.toString() === slot.subject.toString());
          return {
            subjectCode: subj.code,
            status: defaultStatus,
            startTime: slot.startTime,
            endTime: slot.endTime
          };
        });
        
        console.log(`   Recording attendance for ${attendanceData.attendance.length} time slots on ${dayOfWeek}`);
      }
      
      const records = [];
      for (const entry of attendanceData.attendance) {
        console.log(`🔍 Looking for subject: "${entry.subjectCode}"`);
        
        // Find the subject in schedule
        const subject = schedule.subjects.find(s => 
          s.code === entry.subjectCode || 
          s.code.replace(/\s+/g, '') === entry.subjectCode.replace(/\s+/g, '')
        );
        
        if (!subject) {
          console.log(`⚠️  Subject not found: ${entry.subjectCode}`);
          console.log(`   Available subjects: ${schedule.subjects.map(s => s.code).join(', ')}`);
          continue;
        }
        
        console.log(`✅ Matched subject: ${subject.code} - ${subject.name}`);
        
        // Create unique time slot identifier
        const timeSlotKey = entry.startTime && entry.endTime 
          ? `${entry.startTime}-${entry.endTime}` 
          : 'general';
        
        console.log(`   Time slot: ${timeSlotKey}`);
        
        // Check if attendance already exists for this specific time slot
        const existing = await AttendanceRecord.findOne({
          phoneNumber: phoneNumber,
          subjectCode: subject.code,
          date: {
            $gte: date,
            $lt: moment(date).add(1, 'days').toDate()
          },
          timeSlot: timeSlotKey
        });
        
        if (existing) {
          console.log(`   ⚠️  Already recorded for this time slot, updating...`);
          existing.status = entry.status;
          await existing.save();
          records.push(existing);
          continue;
        }
        
        // Create new attendance record
        const record = new AttendanceRecord({
          phoneNumber: phoneNumber,
          subjectCode: subject.code,
          subjectName: subject.name,
          date,
          status: entry.status,
          timeSlot: timeSlotKey,
          notes: entry.notes || ''
        });
        
        await record.save();
        records.push(record);
        console.log(`   ✅ Recorded attendance for ${timeSlotKey}`);
        
        // Update total classes count in schedule subdocument if not cancelled
        if (entry.status !== 'CANCELLED') {
          subject.totalClasses += 1;
          await schedule.save();
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
      // Get student to get phone number
      const student = await Student.findById(studentId);
      if (!student) throw new Error('Student not found');
      
      const phoneNumber = student.phoneNumber;
      
      // Get student schedule with subjects
      const schedule = await Schedule.findOne({ student: studentId }).sort({ createdAt: -1 });
        
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
      
      // Get attendance records using phone number
      const records = await AttendanceRecord.find({ phoneNumber: phoneNumber });
      
      // Calculate overall attendance
      const subjectsData = [];
      let totalClasses = 0;
      let totalPresent = 0;
      
      for (const subject of schedule.subjects) {
        // Count total time slots for this subject in schedule
        const totalSlotsInSchedule = schedule.timeSlots.filter(slot => 
          slot.subject.toString() === subject._id.toString()
        ).length;
        
        // Get attendance records for this subject
        const subjectRecords = records.filter(r => 
          r.subjectCode === subject.code && 
          r.status !== 'CANCELLED' && 
          r.status !== 'HOLIDAY'
        );
        
        const presentCount = subjectRecords.filter(r => r.status === 'PRESENT').length;
        const absentCount = subjectRecords.filter(r => r.status === 'ABSENT').length;
        const totalRecorded = presentCount + absentCount;
        
        // Use totalSlotsInSchedule as the total classes
        const percentage = totalSlotsInSchedule > 0 ? (presentCount / totalSlotsInSchedule * 100).toFixed(1) : 'N/A';
        
        subjectsData.push({
          code: subject.code,
          name: subject.name,
          present: presentCount,
          total: totalSlotsInSchedule,
          percentage: percentage
        });
        
        totalClasses += totalSlotsInSchedule;
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