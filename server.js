import express from "express";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import axios from "axios";
import cors from "cors";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import pLimit from "p-limit";
dayjs.extend(utc);

dotenv.config();

const app = express();
app.use(express.json());
const port = process.env.PORT || 3000;

const HATCH_API_KEY =
  process.env.HATCH_API_KEY ||
  "U2FsdGVkX1-zKpMynFSEIPUisy9gB4NbQlHVTtAdGKOlrXJQIbaa5lF7jRlPcJtuGEd_dM_COndTcAM4N0u_PA";

// Init Supabase client once
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function cleanPhoneNumber(phone) {
  if (Array.isArray(phone) && phone.length > 0) phone = phone[0];
  if (typeof phone === "string") {
    // Remove everything except digits
    phone = phone.replace(/\D/g, "");

    // If it starts with "91", remove the prefix
    if (phone.startsWith("91")) {
      phone = phone.slice(2);
    }

    return phone;
  }
  return "Error";
}

app.post("/api/enrich", (req, res) => {
  const { leads, enrichment_number } = req.body;

  // Validate input...
  res.json({ accepted: true, message: "Enrichment started in background." });

  // Now process in background
  (async () => {
    const limit = pLimit(10);
    const tasks = leads.map((lead) =>
      limit(async () => {
        let phone = "Not Found";
        try {
          const response = await axios.post(
            "https://api.hatchhq.ai/v1/findPhone",
            { linkedinUrl: lead.poc_linkedin },
            { headers: { "x-api-key": HATCH_API_KEY } }
          );
          phone = cleanPhoneNumber(response.data.phone || "Not Found");
        } catch (err) {
          console.error(`API error:`, err.message);
        }

        const columnMap = {
          1: "poc_phonenumber",
          2: "poc_phonenumber_2",
          3: "poc_phonenumber_3",
          4: "poc_phonenumber_4",
        };
        const column = columnMap[enrichment_number];

        try {
          const { error } = await supabase
            .from("Leads")
            .update({ [column]: phone })
            .eq("id", lead.id);
          if (error) {
            console.error(`Supabase error:`, error.message);
          }
        } catch (err) {
          console.error(`Unexpected error:`, err.message);
        }
      })
    );

    await Promise.all(tasks);
    console.log("✅ Enrichment completed.");
  })();
});

// Root health check
app.get("/", (req, res) => {
  res.send("✅ Enrichment API using Supabase client is running.");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
