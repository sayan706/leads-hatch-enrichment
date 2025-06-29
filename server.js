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

app.post("/api/enrich", async (req, res) => {
  const { leads, enrichment_number } = req.body;

  if (!leads || !Array.isArray(leads) || leads.length === 0) {
    return res.status(400).json({ error: "Missing or empty 'leads' array." });
  }

  if (![1, 2].includes(enrichment_number)) {
    return res.status(400).json({ error: "enrichment_number must be 1 or 2." });
  }

  const limit = pLimit(10); // Max 10 concurrent

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
        console.error(`❌ API error for ${lead.poc_linkedin}:`, err.message);
      }

      const column =
        enrichment_number === 2 ? "poc_phonenumber_2" : "poc_phonenumber";

      try {
        const { error } = await supabase
          .from("Leads")
          .update({ [column]: phone })
          .eq("id", lead.id);

        if (error) {
          console.error(`❌ Supabase update error for Lead ID ${lead.id}:`, error.message);
        }
      } catch (err) {
        console.error(`❌ Unexpected Supabase error for Lead ID ${lead.id}:`, err.message);
      }

      return {
        lead_id: lead.id,
        phone,
        column,
      };
    })
  );

  const results = await Promise.all(tasks);

  res.json({
    success: true,
    enriched: results,
  });
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