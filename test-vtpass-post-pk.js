import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const VTPASS_BASE_URL = "https://sandbox.vtpass.com/api";

const getVtpassHeaders = () => ({
  "api-key": process.env.VTPASS_API_KEY,
  "public-key": process.env.VTPASS_PUBLIC_KEY,
  "Content-Type": "application/json",
});

async function testPostWithPublicKey() {
  try {
    const vtpassPayload = {
      request_id: `test-${Date.now()}`,
      serviceID: "mtn",
      amount: 100,
      phone: "08011111111",
    };

    const vtpassRes = await axios.post(
      `${VTPASS_BASE_URL}/pay`,
      vtpassPayload,
      { headers: getVtpassHeaders() }
    );
    console.log("Response POST /pay:", vtpassRes.data);
  } catch (err) {
    console.error("Error POST /pay:", err.response ? err.response.data : err.message);
  }
}
testPostWithPublicKey();
