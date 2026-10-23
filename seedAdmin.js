// scripts/seedAdmin.js
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import userModel from "./models/UserModel.js";

dotenv.config();

const seedAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    const adminEmail = "khosysochisteven@gmail.com";
    const existingAdmin = await userModel.findOne({ email: adminEmail });

    if (existingAdmin) {
      console.log("Admin account already exists.");
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash("SuperSecretAdmin123!", 10);

    const newAdmin = await userModel.create({
      firstName: "Stephen",
      lastName: "Enemchukwu",
      email: adminEmail,
      phone: "07038979295",
      password: hashedPassword,
      role: "super_admin",
      isVerified: true,
      kycTier: 3,
      kycStatus: "VERIFIED",
    });

    console.log("Super Admin created successfully:", newAdmin.email);
    process.exit(0);
  } catch (error) {
    console.error("Error seeding admin:", error.message);
    process.exit(1);
  }
};

seedAdmin();