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

      // Get schedule for subjects list
      const schedule = await this.getSchedule(studentId);

      // Use recorded PRESENT/ABSENT entries to compute summary (more robust if schedule slots are sparse)
      const records = await AttendanceRecord.find({ 
        phoneNumber,
        status: { $in: ['PRESENT', 'ABSENT'] }
      }).lean();

      console.log(`   Found ${records.length} attendance records`);

      const subjects = schedule.subjects || [];
      const subjectStats = [];
      let overallPresent = 0;
      let overallTotal = 0;

      for (const subject of subjects) {
        const subjectRecords = records.filter(r => r.subjectCode === subject.code);
        const presentCount = subjectRecords.filter(r => r.status === 'PRESENT').length;
        const absentCount = subjectRecords.filter(r => r.status === 'ABSENT').length;
        const totalRecorded = presentCount + absentCount;
        const percentage = totalRecorded > 0 ? ((presentCount / totalRecorded) * 100).toFixed(1) : '0.0';

        subjectStats.push({
          code: subject.code,
          name: subject.name,
          present: presentCount,
          absent: absentCount,
          total: totalRecorded,
          percentage
        });

        // Debug log per-subject summary for verification
        try {
          console.log(`   ▶ ${subject.code}: present=${presentCount}, absent=${absentCount}, totalRecorded=${totalRecorded}, pct=${percentage}%`);
        } catch (_) {}

        overallPresent += presentCount;
        overallTotal += totalRecorded;
      }

      const summary = {
        overall: {
          present: overallPresent,
          total: overallTotal,
          percentage: overallTotal > 0 ? ((overallPresent / overallTotal) * 100).toFixed(1) : '0.0'
        },
        subjects: subjectStats
      };

      // Debug log overall summary for verification
      try {
        console.log(`   ▶ OVERALL: present=${summary.overall.present}, total=${summary.overall.total}, pct=${summary.overall.percentage}%`);
      } catch (_) {}

      return summary;

    } catch (error) {
      console.error('❌ Error getting attendance summary:', error);
      throw error;
    }
  }

  /**
   * Rename a subject (code/name) and migrate attendance records accordingly
   */
  async renameSubject(studentId, { oldSubjectCode, newSubjectCode, newSubjectName }) {
    if (!oldSubjectCode || (!newSubjectCode && !newSubjectName)) {
      throw new Error('Missing fields: oldSubjectCode and at least one of newSubjectCode/newSubjectName are required');
    }

    const student = await Student.findById(studentId);
    if (!student) throw new Error('Student not found');

    const schedule = await Schedule.findOne({ student: studentId }).sort({ createdAt: -1 });
    if (!schedule) throw new Error('Schedule not found');

    const subject = schedule.subjects.find(s => s.code.toLowerCase() === oldSubjectCode.toLowerCase());
    if (!subject) throw new Error(`Subject ${oldSubjectCode} not found in schedule`);

    const prevCode = subject.code;
    const prevName = subject.name;

    if (newSubjectCode) subject.code = newSubjectCode;
    if (newSubjectName) subject.name = newSubjectName;
    await schedule.save();

    // Migrate attendance records to the new code/name
    const updateSet = {};
    if (newSubjectCode) updateSet.subjectCode = newSubjectCode;
    if (newSubjectName) updateSet.subjectName = newSubjectName;

    let migrated = 0;
    if (Object.keys(updateSet).length > 0) {
      const res = await AttendanceRecord.updateMany(
        { phoneNumber: student.phoneNumber, subjectCode: prevCode },
        { $set: updateSet }
      );
      migrated = res.modifiedCount || 0;
    }

    this.clearCache(studentId, student.phoneNumber);
    return { renamed: true, from: { code: prevCode, name: prevName }, to: { code: subject.code, name: subject.name }, migrated };
  }

  /**
   * Reassign a specific timeslot's subject to another subject code
   */
  async reassignTimeSlotSubject(studentId, { day, startTime, endTime, toSubjectCode, fromSubjectCode }) {
    if (!day || !startTime || !endTime || !toSubjectCode) {
      throw new Error('Missing fields: day, startTime, endTime, toSubjectCode are required');
    }

    const student = await Student.findById(studentId);
    if (!student) throw new Error('Student not found');

    const schedule = await Schedule.findOne({ student: studentId }).sort({ createdAt: -1 });
    if (!schedule) throw new Error('Schedule not found');

    const toSubj = schedule.subjects.find(s => s.code.toLowerCase() === toSubjectCode.toLowerCase());
    if (!toSubj) throw new Error(`Target subject ${toSubjectCode} not found in schedule`);

    const fromSubj = fromSubjectCode ? schedule.subjects.find(s => s.code.toLowerCase() === fromSubjectCode.toLowerCase()) : null;

    // Update matching slots
    let changed = 0;
    for (const slot of schedule.timeSlots) {
      if (slot.day === day && slot.startTime === startTime && slot.endTime === endTime) {
        if (!fromSubj || slot.subject.toString() === fromSubj._id.toString()) {
          slot.subject = toSubj._id;
          changed++;
        }
      }
    }
    await schedule.save();

    // Optionally migrate existing attendance records for those timeslots
    let migrated = 0;
    const timeSlotKey = `${startTime}-${endTime}`;
    const filter = { phoneNumber: student.phoneNumber, timeSlot: timeSlotKey };
    if (fromSubjectCode) filter.subjectCode = fromSubjectCode;

    const update = { $set: { subjectCode: toSubj.code, subjectName: toSubj.name } };
    const res = await AttendanceRecord.updateMany(filter, update);
    migrated = res.modifiedCount || 0;

    this.clearCache(studentId, student.phoneNumber);
    return { changedSlots: changed, migratedRecords: migrated, to: { code: toSubj.code, name: toSubj.name } };
  }

  /**
   * Modify subject wrapper: decide rename vs timeslot reassignment
   */
  async modifySubject(studentId, payload) {
    if (payload.oldSubjectCode || payload.newSubjectName) {
      return this.renameSubject(studentId, {
        oldSubjectCode: payload.oldSubjectCode,
        newSubjectCode: payload.newSubjectCode,
        newSubjectName: payload.newSubjectName
      });
    }
    if (payload.day && payload.startTime && payload.endTime && payload.newSubjectCode) {
      return this.reassignTimeSlotSubject(studentId, {
        day: payload.day,
        startTime: payload.startTime,
        endTime: payload.endTime,
        toSubjectCode: payload.newSubjectCode,
        fromSubjectCode: payload.fromSubjectCode
      });
    }
    throw new Error('Insufficient data to modify subject');
  }

  /**
   * Modify attendance for a given subject/date by updating all matching slots
   */
  async modifyAttendance(studentId, { subjectCode, date, status }) {
    try {
      if (!subjectCode || !date || !status) {
        throw new Error('Missing subjectCode, date or status');
      }

      const student = await Student.findById(studentId);
      if (!student) throw new Error('Student not found');

      // Need full schedule doc (no lean) to access subdocument _id
      const schedule = await Schedule.findOne({ student: studentId }).sort({ createdAt: -1 });
      if (!schedule) throw new Error('Schedule not found');

      // Resolve date robustly
      const parsed = moment(date, [moment.ISO_8601, 'YYYY-MM-DD', 'DD-MM-YYYY', 'DD/MM/YYYY', 'MMM D, YYYY', 'D MMM YYYY'], true);
      const dateObj = parsed.isValid() ? parsed.clone().startOf('day') : moment(new Date(date)).startOf('day');
      if (!dateObj.isValid()) throw new Error('Invalid date format');

      // Find subject by code (normalize spaces/case)
      const subj = schedule.subjects.find(s => 
        s.code.toLowerCase() === subjectCode.toLowerCase() ||
        s.code.replace(/\s+/g, '').toLowerCase() === subjectCode.replace(/\s+/g, '').toLowerCase()
      );
      if (!subj) throw new Error(`Subject ${subjectCode} not found in schedule`);

      const dayOfWeek = dateObj.format('dddd');
      const daySlots = schedule.timeSlots.filter(slot => slot.day === dayOfWeek && slot.subject.toString() === subj._id.toString());
      if (daySlots.length === 0) throw new Error(`${subj.code} is not scheduled on ${dayOfWeek}`);

      const phoneNumber = student.phoneNumber;
      const start = dateObj.toDate();
      const end = dateObj.clone().add(1, 'day').toDate();
      let updated = 0;

      for (const slot of daySlots) {
        const timeSlotKey = `${slot.startTime}-${slot.endTime}`;
        await AttendanceRecord.findOneAndUpdate(
          {
            phoneNumber,
            subjectCode: subj.code,
            date: { $gte: start, $lt: end },
            timeSlot: timeSlotKey
          },
          {
            $set: {
              phoneNumber,
              subjectCode: subj.code,
              subjectName: subj.name,
              date: start,
              status: status.toUpperCase(),
              timeSlot: timeSlotKey,
              notes: 'Modified by student'
            }
          },
          { upsert: true, new: true }
        );
        updated++;
      }

      // Clear cache so subsequent reads are fresh
      this.clearCache(studentId, phoneNumber);

      return { updated, subject: subj.code, day: dayOfWeek, date: dateObj.format('YYYY-MM-DD') };
    } catch (error) {
      console.error('❌ Error modifying attendance:', error);
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
