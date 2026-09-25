import axios from "axios";

const VTPASS_BASE_URL = "https://sandbox.vtpass.com/api";

const getVtpassHeaders = () => ({
  "api-key": "b811cb6638be06998f88e8b7879555ae",
  "secret-key": "SK_775606fe84bbf5389893148177da0a39dad38191664",
  "Content-Type": "application/json",
});

async function testPostReal() {
  try {
    const vtpassPayload = {
      request_id: `20260908123456789`,
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
testPostReal();
