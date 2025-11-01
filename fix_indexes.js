require('dotenv').config();
const mongoose = require('mongoose');

async function fixIndexes() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db;
    const collection = db.collection('attendancerecords');
    
    // Get current indexes
    const indexes = await collection.indexes();
    console.log('Current indexes:');
    indexes.forEach(idx => {
      console.log(`  - ${idx.name}:`, idx.key);
    });
    
    console.log('\nDropping old unique index...');
    try {
      await collection.dropIndex('phoneNumber_1_subjectCode_1_date_1');
      console.log('✅ Dropped old index');
    } catch (err) {
      console.log('⚠️  Old index not found or already dropped');
    }
    
    console.log('\nCreating new unique index with timeSlot...');
    await collection.createIndex(
      { phoneNumber: 1, subjectCode: 1, date: 1, timeSlot: 1 },
      { unique: true }
    );
    console.log('✅ Created new index');
    
    console.log('\nNew indexes:');
    const newIndexes = await collection.indexes();
    newIndexes.forEach(idx => {
      console.log(`  - ${idx.name}:`, idx.key);
    });
    
    await mongoose.disconnect();
    console.log('\n✅ Done!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixIndexes();
