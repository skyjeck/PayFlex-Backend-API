import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const VTPASS_BASE_URL = "https://sandbox.vtpass.com/api";

const getVtpassHeaders = () => ({
  "api-key": process.env.VTPASS_API_KEY,
  "public-key": process.env.VTPASS_PUBLIC_KEY,
});

async function testGet() {
  try {
    const vtpassRes = await axios.get(
      `${VTPASS_BASE_URL}/service-variations?serviceID=mtn`,
      { headers: getVtpassHeaders() }
    );
    console.log("Response GET:", vtpassRes.data);
  } catch (err) {
    console.error("Error GET:", err.response ? err.response.data : err.message);
  }
}
testGet();
