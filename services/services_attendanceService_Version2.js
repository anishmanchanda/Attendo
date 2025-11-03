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
      
      // Get attendance records using phone number (only PRESENT/ABSENT for summary)
      const records = await AttendanceRecord.find({ 
        phoneNumber: phoneNumber,
        status: { $in: ['PRESENT', 'ABSENT'] }
      });

      // Calculate subject-wise summary based on recorded data
      const subjectsData = [];
      let totalRecordedAll = 0;
      let totalPresentAll = 0;

      for (const subject of schedule.subjects) {
        const subjectRecords = records.filter(r => r.subjectCode === subject.code);
        const presentCount = subjectRecords.filter(r => r.status === 'PRESENT').length;
        const absentCount = subjectRecords.filter(r => r.status === 'ABSENT').length;
        const totalRecorded = presentCount + absentCount;

        const percentage = totalRecorded > 0 
          ? (presentCount / totalRecorded * 100).toFixed(1) 
          : '0.0';

        subjectsData.push({
          code: subject.code,
          name: subject.name,
          present: presentCount,
          absent: absentCount,
          total: totalRecorded,
          percentage
        });

        totalRecordedAll += totalRecorded;
        totalPresentAll += presentCount;
      }

      const overallPercentage = totalRecordedAll > 0 
        ? (totalPresentAll / totalRecordedAll * 100).toFixed(1)
        : '0.0';

      return {
        overall: {
          present: totalPresentAll,
          total: totalRecordedAll,
          percentage: overallPercentage
        },
        subjects: subjectsData
      };
    } catch (error) {
      console.error('Error getting attendance summary:', error);
      throw error;
    }
  }

  /**
   * Modify attendance for a given subject and date
   */
  async modifyAttendance(studentId, modifyData) {
    try {
      const { subjectCode, date, status } = modifyData;
      if (!subjectCode || !date || !status) {
        throw new Error('Missing subjectCode, date or status');
      }

      const student = await Student.findById(studentId);
      if (!student) throw new Error('Student not found');

      const schedule = await Schedule.findOne({ student: studentId }).sort({ createdAt: -1 });
      if (!schedule) throw new Error('Schedule not found');

      const targetDate = moment(date, [moment.ISO_8601, 'YYYY-MM-DD', 'DD-MM-YYYY', 'DD/MM/YYYY', 'MMM D, YYYY', 'D MMM YYYY'], true);
      const dateObj = targetDate.isValid() ? targetDate.clone().startOf('day') : moment(new Date(date)).startOf('day');
      if (!dateObj.isValid()) throw new Error('Invalid date format');

      // Find the subject in schedule
      const subject = schedule.subjects.find(s => 
        s.code.toLowerCase() === subjectCode.toLowerCase() ||
        s.code.replace(/\s+/g, '').toLowerCase() === subjectCode.replace(/\s+/g, '').toLowerCase()
      );
      if (!subject) throw new Error(`Subject ${subjectCode} not found in schedule`);

      const dayOfWeek = dateObj.format('dddd');

      // Get all slots for this subject on that weekday
      const daySlots = schedule.timeSlots.filter(slot => 
        slot.day === dayOfWeek && slot.subject.toString() === subject._id.toString()
      );

      if (daySlots.length === 0) {
        throw new Error(`${subject.code} is not scheduled on ${dayOfWeek}`);
      }

      const phoneNumber = student.phoneNumber;
      const updates = [];
      const dayStart = dateObj.toDate();
      const dayEnd = dateObj.clone().add(1, 'day').toDate();

      for (const slot of daySlots) {
        const timeSlotKey = `${slot.startTime}-${slot.endTime}`;
        const updated = await AttendanceRecord.findOneAndUpdate(
          {
            phoneNumber,
            subjectCode: subject.code,
            date: { $gte: dayStart, $lt: dayEnd },
            timeSlot: timeSlotKey
          },
          {
            $set: {
              phoneNumber,
              subjectCode: subject.code,
              subjectName: subject.name,
              date: dayStart,
              status: status.toUpperCase(),
              timeSlot: timeSlotKey,
              notes: 'Modified by student'
            }
          },
          { upsert: true, new: true }
        );
        updates.push(updated);
      }

      return { updated: updates.length, subject: subject.code, day: dayOfWeek, date: dateObj.format('YYYY-MM-DD') };
    } catch (error) {
      console.error('Error modifying attendance:', error);
      throw error;
    }
  }
}

module.exports = new AttendanceService();