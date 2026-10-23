import axios from "axios";
import User from "../models/UserModel.js"; // Adjust path to your User model

// live credit check function using NIN or BVN

// export const performCreditCheck = async (userId) => {
//   // 1. Fetch user identification details from your database
//   const user = await User.findById(userId);

//   // Use NIN or BVN from kycDetails as the government ID
//   const governmentId = user?.kycDetails?.nin || user?.kycDetails?.bvn;

//   if (!user || !governmentId) {
//     throw new Error("User record or government identification missing. Please complete your KYC to apply for a loan.");
//   }

//   if (user.kycStatus !== "VERIFIED") {
//     throw new Error("Your KYC verification is not yet approved. Please complete KYC verification before applying for a loan.");
//   }

//   try {
//     // 2. Call external credit bureau API
//     const response = await axios.post(
//       process.env.CREDIT_BUREAU_API_URL || "https://api.creditbureau.com/v1/score",
//       {
//         nationalId: governmentId,
//         firstName: user.firstName,
//         lastName: user.lastName,
//         dateOfBirth: user.dateOfBirth,
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${process.env.CREDIT_BUREAU_API_KEY}`,
//           "Content-Type": "application/json",
//         },
//         timeout: 8000, // 8-second timeout to avoid keeping the request hanging
//       }
//     );

//     // 3. Extract the credit score from the provider's response body
//     // Adjust key names according to your provider's payload structure
//     const { creditScore, status, referenceId } = response.data;

//     if (status !== "SUCCESS" || typeof creditScore !== "number") {
//       return {
//         eligible: false,
//         creditScore: null,
//         maxLimit: 0,
//         reason: "Unable to retrieve valid credit history from the provider.",
//       };
//     }

//     // 4. Map the score to eligibility and maximum loan limits
//     if (creditScore < 580) {
//       return {
//         eligible: false,
//         creditScore,
//         maxLimit: 0,
//         referenceId,
//         reason: "Credit score is below the minimum requirement.",
//       };
//     }

//     let maxLimit = 2000;
//     if (creditScore > 740) maxLimit = 25000;
//     else if (creditScore > 660) maxLimit = 10000;

//     return {
//       eligible: true,
//       creditScore,
//       maxLimit,
//       referenceId,
//     };
//   } catch (error) {
//     console.error("Credit Bureau API Integration Error:", error.response?.data || error.message);

//     // Differentiate API errors (e.g., 404 score not found vs 500 server errors)
//     if (error.response?.status === 404) {
//       return {
//         eligible: false,
//         creditScore: null,
//         maxLimit: 0,
//         reason: "No credit history found for the provided details.",
//       };
//     }

//     // Rethrow or return a fallback error state for 5xx network failures
//     throw new Error("Credit check service is temporarily unavailable. Please try again later.");
//   }
// };


// mockup credit check function with sandbox mode for development and testing
export const performCreditCheck = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new Error("User record not found.");
  }

  const governmentId = user?.kycDetails?.nin || user?.kycDetails?.bvn;

  if (!governmentId) {
    throw new Error("Government identification (NIN or BVN) missing. Please complete KYC.");
  }

  if (user.kycStatus !== "VERIFIED") {
    throw new Error("Your KYC verification is pending. Please complete KYC before applying.");
  }

  // -------------------------------------------------------------------
  // 1. FREE LOCAL / SANDBOX MODE (For development and testing)
  // -------------------------------------------------------------------
  if (process.env.NODE_ENV === "development" || process.env.USE_MOCK_CREDIT === "true") {
    // Generate a deterministic mock score or set default
    const mockScore = user.mockCreditScore || 710;

    if (mockScore < 580) {
      return {
        eligible: false,
        creditScore: mockScore,
        maxLimit: 0,
        reason: "Credit score is below the minimum requirement.",
      };
    }

    let maxLimit = 2000;
    if (mockScore > 740) maxLimit = 25000;
    else if (mockScore > 660) maxLimit = 10000;

    return {
      eligible: true,
      creditScore: mockScore,
      maxLimit,
      referenceId: `MOCK_REF_${Date.now()}`,
    };
  }

  // -------------------------------------------------------------------
  // 2. LIVE PRODUCTION CREDIT BUREAU / AGGREGATOR CALL (e.g., Mono/CRC)
  // -------------------------------------------------------------------
  try {
    const response = await axios.post(
      process.env.CREDIT_BUREAU_API_URL || "https://api.mono.co/v3/lookup/credit-history/crc",
      { bvn: governmentId },
      {
        headers: {
          "mono-sec-key": process.env.CREDIT_BUREAU_API_KEY,
          "Content-Type": "application/json",
        },
        timeout: 8000,
      }
    );

    const { status, data } = response.data;
    const creditScore = data?.credit_score || data?.profile?.score;

    if (status !== "successful" || typeof creditScore !== "number") {
      return {
        eligible: false,
        creditScore: null,
        maxLimit: 0,
        reason: "Unable to retrieve credit score from provider.",
      };
    }

    if (creditScore < 580) {
      return {
        eligible: false,
        creditScore,
        maxLimit: 0,
        referenceId: data?.reference,
        reason: "Credit score is below the minimum requirement.",
      };
    }

    let maxLimit = 2000;
    if (creditScore > 740) maxLimit = 25000;
    else if (creditScore > 660) maxLimit = 10000;

    return {
      eligible: true,
      creditScore,
      maxLimit,
      referenceId: data?.reference || `REF_${Date.now()}`,
    };
  } catch (error) {
    console.error("Credit Check API Error:", error.response?.data || error.message);

    if (error.response?.status === 404) {
      return {
        eligible: false,
        creditScore: null,
        maxLimit: 0,
        reason: "No credit history found for the provided NIN/BVN.",
      };
    }

    throw new Error("Credit check service is temporarily unavailable. Please try again later.");
  }
};