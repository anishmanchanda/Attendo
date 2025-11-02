const Student = require('../models/models_Student_Version2');
const { Schedule } = require('../models/models_Schedule_Version2');
const AttendanceRecord = require('../models/models_Attendance_Version2');
const moment = require('moment');

class AttendanceService {
  constructor() {
    this.cache = new Map(); // Simple in-memory cache
    console.log('🚀 Production Attendance Service initialized with caching');
  }

  /**
   * Get student with caching
   */
  async getStudent(phoneNumber) {
    const cacheKey = `student:${phoneNumber}`;
    
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < 300000) { // 5 min cache
        return cached.data;
      }
    }

    const student = await Student.findOne({ phoneNumber });
    if (!student) {
      throw new Error('Student not found. Please register first.');
    }

    this.cache.set(cacheKey, { data: student, timestamp: Date.now() });
    return student;
  }

  /**
   * Get schedule with caching
   */
  async getSchedule(studentId) {
    const cacheKey = `schedule:${studentId}`;
    
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < 300000) { // 5 min cache
        return cached.data;
      }
    }

    const schedule = await Schedule.findOne({ student: studentId })
      .sort({ createdAt: -1 })
      .lean(); // Use lean() for better performance

    if (!schedule) {
      throw new Error('Schedule not found. Please upload your schedule first.');
    }

    this.cache.set(cacheKey, { data: schedule, timestamp: Date.now() });
    return schedule;
  }

  /**
   * Register student (kept from original)
   */
  async registerStudent(phoneNumber, studentData) {
    try {
      let student = await Student.findOne({ phoneNumber });
      
      if (student) {
        student.rollNumber = studentData.rollNumber;
        student.name = studentData.name || student.name;
        student.semester = studentData.semester;
        await student.save();
      } else {
        student = new Student({
          phoneNumber,
          rollNumber: studentData.rollNumber,
          name: studentData.name || 'Student',
          semester: studentData.semester,
          subjects: []
        });
        await student.save();
      }
      
      await this.updateStudentSchedule(student._id, studentData);
      
      // Clear cache
      this.clearCache(student._id, phoneNumber);
      
      return student;
    } catch (error) {
      console.error('Error registering student:', error);
      throw error;
    }
  }

  /**
   * Update student schedule (kept from original)
   */
  async updateStudentSchedule(studentId, scheduleData) {
    try {
      await Schedule.deleteMany({ student: studentId });
      
      const subjectDocs = [];
      for (const subjectData of scheduleData.subjects) {
        subjectDocs.push({
          model: {
            code: subjectData.code,
            name: subjectData.name,
            totalClasses: 0
          },
          code: subjectData.code
        });
      }
      
      const schedule = new Schedule({
        student: studentId,
        semester: scheduleData.semester,
        subjects: subjectDocs.map(s => s.model),
        timeSlots: []
      });
      
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
      
      // Clear cache
      this.cache.delete(`schedule:${studentId}`);
      
      return schedule;
    } catch (error) {
      console.error('Error updating student schedule:', error);
      throw error;
    }
  }

  /**
   * Record attendance - Production version with validation
   */
  async recordAttendance(studentId, attendanceData) {
    try {
      const dateObj = moment(attendanceData.date).startOf('day');
      
      if (!dateObj.isValid()) {
        throw new Error('Invalid date format');
      }

      const student = await Student.findById(studentId);
      if (!student) throw new Error('Student not found');
      
      const phoneNumber = student.phoneNumber;
      const schedule = await this.getSchedule(studentId);
      const dayOfWeek = dateObj.format('dddd');

      console.log(`📅 Recording attendance for ${phoneNumber} on ${dateObj.format('YYYY-MM-DD')} (${dayOfWeek})`);

      // Validate that there are classes on this day
      const daySlots = schedule.timeSlots.filter(slot => 
        slot.day.toLowerCase() === dayOfWeek.toLowerCase()
      );

      if (daySlots.length === 0 && !attendanceData.isHoliday) {
        throw new Error(`No classes scheduled on ${dayOfWeek}. Please check your schedule.`);
      }

      console.log(`   ✅ Found ${daySlots.length} time slots for ${dayOfWeek}`);

      const date = dateObj.toDate();

      // Handle holiday
      if (attendanceData.isHoliday) {
        return await this.recordHoliday(phoneNumber, date, schedule, daySlots);
      }

      // Determine what to record
      let recordsToCreate = [];

      if (attendanceData.needsDayFilter) {
        console.log(`   📝 Recording all ${daySlots.length} classes for ${dayOfWeek}`);
        
        const defaultStatus = attendanceData.attendance.length > 0 ? attendanceData.attendance[0].status : 'PRESENT';
        
        recordsToCreate = daySlots.map(slot => {
          const subject = schedule.subjects.find(s => 
            s._id.toString() === slot.subject.toString()
          );
          
          if (!subject) {
            console.warn(`   ⚠️  Subject not found for slot: ${slot.subject}`);
            return null;
          }

          return {
            phoneNumber,
            date,
            subjectCode: subject.code,
            subjectName: subject.name,
            status: defaultStatus,
            timeSlot: `${slot.startTime}-${slot.endTime}`
          };
        }).filter(Boolean);

      } else {
        console.log(`   📝 Recording ${attendanceData.attendance.length} specific subjects`);
        
        for (const entry of attendanceData.attendance) {
          const subject = schedule.subjects.find(s => 
            s.code.toLowerCase() === entry.subjectCode.toLowerCase() ||
            s.code.replace(/\s+/g, '').toLowerCase() === entry.subjectCode.replace(/\s+/g, '').toLowerCase()
          );

          if (!subject) {
            console.warn(`   ⚠️  Subject ${entry.subjectCode} not found in schedule`);
            continue;
          }

          const subjectSlots = daySlots.filter(slot => 
            slot.subject.toString() === subject._id.toString()
          );

          if (subjectSlots.length === 0) {
            console.warn(`   ⚠️  ${subject.code} not scheduled on ${dayOfWeek}`);
            continue;
          }

          for (const slot of subjectSlots) {
            recordsToCreate.push({
              phoneNumber,
              date,
              subjectCode: subject.code,
              subjectName: subject.name,
              status: entry.status || 'PRESENT',
              timeSlot: `${slot.startTime}-${slot.endTime}`
            });
          }
        }
      }

      if (recordsToCreate.length === 0) {
        throw new Error('No valid attendance records to create');
      }

      // Upsert records
      let recordedCount = 0;
      const errors = [];

      for (const record of recordsToCreate) {
        try {
          const result = await AttendanceRecord.updateOne(
            {
              phoneNumber: record.phoneNumber,
              subjectCode: record.subjectCode,
              date: record.date,
              timeSlot: record.timeSlot
            },
            { $set: record },
            { upsert: true }
          );

          if (result.upsertedCount > 0 || result.modifiedCount > 0) {
            recordedCount++;
            console.log(`   ✅ ${record.subjectCode} (${record.timeSlot}) - ${record.status}`);
          }
        } catch (error) {
          console.error(`   ❌ Error recording ${record.subjectCode}:`, error.message);
          errors.push(`Failed to record ${record.subjectCode}: ${error.message}`);
        }
      }

      this.clearCache(studentId, phoneNumber);
      
      console.log(`✅ Successfully recorded ${recordedCount} attendance entries`);

      return recordsToCreate.slice(0, recordedCount);

    } catch (error) {
      console.error('❌ Error recording attendance:', error);
      throw error;
    }
  }

  /**
   * Record holiday for all classes on a day
   */
  async recordHoliday(phoneNumber, date, schedule, daySlots) {
    try {
      const holidayRecords = [];

      for (const slot of daySlots) {
        const subject = schedule.subjects.find(s => s._id.toString() === slot.subject.toString());
        
        if (!subject) continue;

        await AttendanceRecord.updateOne(
          {
            phoneNumber,
            subjectCode: subject.code,
            date,
            timeSlot: `${slot.startTime}-${slot.endTime}`
          },
          {
            $set: {
              phoneNumber,
              date,
              subjectCode: subject.code,
              subjectName: subject.name,
              status: 'HOLIDAY',
              timeSlot: `${slot.startTime}-${slot.endTime}`
            }
          },
          { upsert: true }
        );

        holidayRecords.push({
          phoneNumber,
          date,
          subjectCode: subject.code,
          subjectName: subject.name,
          status: 'HOLIDAY',
          timeSlot: `${slot.startTime}-${slot.endTime}`
        });
      }

      console.log(`   🎉 Recorded holiday for ${holidayRecords.length} classes`);

      return holidayRecords;
    } catch (error) {
      console.error('❌ Error recording holiday:', error);
      throw error;
    }
  }

  /**
   * Get attendance summary with optimized queries
   */
  async getAttendanceSummary(studentId) {
    try {
      const student = await Student.findById(studentId);
      if (!student) throw new Error('Student not found');
      
      const phoneNumber = student.phoneNumber;
      console.log(`📊 Getting attendance summary for ${phoneNumber}`);

      const schedule = await this.getSchedule(studentId);

      const records = await AttendanceRecord.find({ 
        phoneNumber,
        status: { $in: ['PRESENT', 'ABSENT'] }
      }).lean();

      console.log(`   Found ${records.length} attendance records`);

      const recordsBySubject = records.reduce((acc, record) => {
        if (!acc[record.subjectCode]) {
          acc[record.subjectCode] = [];
        }
        acc[record.subjectCode].push(record);
        return acc;
      }, {});

      const subjectStats = schedule.subjects.map(subject => {
        const totalSlots = schedule.timeSlots.filter(slot => 
          slot.subject.toString() === subject._id.toString()
        ).length;

        const subjectRecords = recordsBySubject[subject.code] || [];
        const presentCount = subjectRecords.filter(r => r.status === 'PRESENT').length;
        const absentCount = subjectRecords.filter(r => r.status === 'ABSENT').length;

        const percentage = totalSlots > 0 
          ? ((presentCount / totalSlots) * 100).toFixed(1) 
          : '0.0';

        return {
          code: subject.code,
          name: subject.name,
          present: presentCount,
          absent: absentCount,
          notMarked: totalSlots - presentCount - absentCount,
          total: totalSlots,
          percentage
        };
      });

      const totalSlots = subjectStats.reduce((sum, s) => sum + s.total, 0);
      const totalPresent = subjectStats.reduce((sum, s) => sum + s.present, 0);
      const overallPercentage = totalSlots > 0 
        ? ((totalPresent / totalSlots) * 100).toFixed(1) 
        : '0.0';

      return {
        overall: {
          present: totalPresent,
          total: totalSlots,
          percentage: overallPercentage
        },
        subjects: subjectStats
      };

    } catch (error) {
      console.error('❌ Error getting attendance summary:', error);
      throw error;
    }
  }

  /**
   * Clear cache for a student
   */
  clearCache(studentId, phoneNumber) {
    this.cache.delete(`student:${phoneNumber}`);
    this.cache.delete(`schedule:${studentId}`);
  }
}

module.exports = new AttendanceService();
