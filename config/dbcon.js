import mongoose from "mongoose";

// One-time migration: drop the stale single-field userId_1 unique index
// on the wallets collection. It was replaced by the compound (userId, currency)
// index to support multi-currency wallets, but MongoDB never auto-drops old indexes.
async function dropStaleWalletIndex() {
  try {
    const db = mongoose.connection.db;
    const collection = db.collection("wallets");
    const indexes = await collection.indexes();
    const stale = indexes.find(
      (idx) =>
        idx.name === "userId_1" &&
        Object.keys(idx.key).length === 1 &&
        idx.key.userId !== undefined
    );
    if (stale) {
      await collection.dropIndex("userId_1");
      console.log("✅ Dropped stale wallet index: userId_1");
    }
  } catch (err) {
    // Safe to ignore if index doesn't exist
    if (err.codeName !== "IndexNotFound") {
      console.warn("⚠️  Could not drop stale wallet index:", err.message);
    }
  }
}

export async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDb database");
    await dropStaleWalletIndex();
  } catch (err) {
    console.error("Database connection error:", err.stack);
  }
}


