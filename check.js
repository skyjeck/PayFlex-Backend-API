import mongoose from 'mongoose';
async function run() {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/payflex');
    const users = await mongoose.connection.db.collection('users').find({}).toArray();
    console.log('USERS:', users.map(u => u.email));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
