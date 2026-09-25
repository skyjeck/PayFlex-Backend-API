import axios from "axios";

const VTPASS_BASE_URL = "https://sandbox.vtpass.com/api";

const getVtpassHeaders = () => ({
  "api-key": "your_sandbox_api_key",
  "secret-key": "your_sandbox_secret_key",
  "Content-Type": "application/json",
});

async function testPostWrongKeys() {
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
testPostWrongKeys();
