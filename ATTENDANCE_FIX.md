# Attendance Recording Fix

## Problem
Attendance records were using MongoDB ObjectIds (`student._id` and `subject._id`) which could cause issues with:
- Multiple records for the same student
- Subject references breaking when subdocuments change
- Difficulty querying by phone number

## Solution
Changed attendance model to use **phone number as the primary identifier**:

### Old Model
```javascript
{
  student: ObjectId,      // References Student document
  subject: ObjectId,      // References Subject subdocument
  date: Date,
  status: String
}
```

### New Model
```javascript
{
  phoneNumber: String,    // Direct phone number (indexed)
  subjectCode: String,    // Subject code like "PC-209"
  subjectName: String,    // Subject name for display
  date: Date,
  status: String
}
```

### Key Changes

1. **Unique Index**: `phoneNumber + subjectCode + date` ensures one record per student per subject per day

2. **Phone Number Identifier**: All queries now use phone number instead of ObjectId:
   - Recording: `AttendanceRecord.find({ phoneNumber: '917428912104' })`
   - Updating: Replaces old record by `phoneNumber + subjectCode + date`

3. **Schedule Query Fix**: All schedule queries now use `.sort({ createdAt: -1 })` to get most recent schedule

4. **Better Logging**: Added detailed logs to track attendance recording

## Benefits
✅ Phone number is stable (never changes)
✅ No dependency on ObjectIds that may change
✅ Easy to query by phone number
✅ Prevents duplicate records with unique index
✅ Subject codes are stable identifiers

## Testing
Try these on WhatsApp:
1. "I attended all classes today" - Should record attendance
2. "Show my attendance summary" - Should display percentages
3. Check logs with: `tail -f /tmp/app.log`
