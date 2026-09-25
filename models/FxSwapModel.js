import mongoose from "mongoose";

const fxSwapSchema = new mongoose.Schema(
    {
        userId:{
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        sourceCurrency:{
            type: String,
            required: true,
            uppercase: true,
        },
        targetCurrency:{
            type: String,
            required: true,
            uppercase: true,
        },
        sourceAmount:{
            type: Number,
            required: true,
        },
        targetAmount:{
            type: Number,
            required: true,
        },
        exchangeRate:{
            type: Number,
            required: true,
        },
        fee:{
            type: Number,
            default: 0
        },
        reference:{
            type: String,
            required: true,
            unique: true,
            index: true
        },
        provider:{
            type: String,
            default: "INTERNAL"
        },
        providerReference:{
            type: String
        },
        status:{
            type: String,
            enum: [
                    "QUOTE", 
                    "PENDING",
                    "PROCESSING",
                    "COMPLETED",
                    "FAILED",
                    "REVERSED",
                    "EXPIRED"
                ],
            default: "PENDING",
        },
    },
    {timestamps: true}
);


export default mongoose.model("Fxswap", fxSwapSchema);