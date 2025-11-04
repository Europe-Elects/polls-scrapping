import { BlobServiceClient } from "@azure/storage-blob";
import axios from "axios";
import * as cheerio from "cheerio";

const CONN_STRING = process.env.STORAGE_ACCOUNT_CONNECTION_STRING;
const CONTAINER = process.env.STATE_CONTAINER_NAME;
const BLOB_NAME = process.env.STATE_BLOB_NAME;

const blobService = BlobServiceClient.fromConnectionString(CONN_STRING);
const containerClient = blobService.getContainerClient(CONTAINER);
const blobClient = containerClient.getBlockBlobClient(BLOB_NAME);

// ---- Load state from blob ----
async function loadState() {
  try {
    const exists = await blobClient.exists();
    if (!exists) return {};
    const download = await blobClient.download();
    const text = await streamToString(download.readableStreamBody);
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// ---- Save state to blob ----
async function saveState(state) {
  await blobClient.upload(JSON.stringify(state, null, 2), Buffer.byteLength(JSON.stringify(state)));
}

// Helper for stream reading
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// ✅ Parse German date format (DD.MM.YYYY) to ISO (YYYY-MM-DD)
function parseGermanDate(dateStr) {
  const parts = dateStr.trim().match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!parts) return null;
  const [, day, month, year] = parts;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export default async function scrapeWahlrecht() {
  const state = await loadState();
  const updated = [];

  console.log("📡 Fetching wahlrecht.de...");
  const { data } = await axios.get("https://www.wahlrecht.de/umfragen/");
  const $ = cheerio.load(data);

  const table = $("table.wilko");

  const institutes = table.find("thead tr th.in").map((i, el) => ({
    name: $(el).text().split(/\s+/)[0].trim(),
    link: $(el).find("a").attr("href")
  })).get();

  const dates = table.find("tbody tr#datum td").map((i, el) => {
    const raw = $(el).text().trim();
    return {
      raw,
      parsed: parseGermanDate(raw),
    };
  }).get();

  const partyRowMap = {
    "cdu": "CDU",
    "afd": "AFD",
    "spd": "SPD",
    "gru": "GRU",
    "lin": "LIN",
    "bsw": "BSW",
    "fdp": "FDP",
    "son": "Others",
  };

  for (const [rowId, party] of Object.entries(partyRowMap)) {
    const row = table.find(`tr#${rowId}`);
    
    row.find("td").each((colIndex, cell) => {
      
      // ✅ Start with default institute from header row
      let institute = institutes[colIndex];
      if (!institute) return;
  
      let instituteName = institute.name;
      let instituteLink = institute.link;
  
      // ✅ Try override with hyperlink inside the party cell → very reliable for INSA
      const anchor = $(cell).find("a[href]").first();
      // ✅ More reliable institute identification
      if (anchor.length) {
        const href = anchor.attr("href").toLowerCase();
      
        // Order: most specific first
        if (href.includes("insa")) {
          instituteName = "INSA";
        } else if (href.includes("yougov")) {
          instituteName = "YouGov";
        } else if (href.includes("forsa")) {
          instituteName = "Forsa";
        } else if (href.includes("kantar")) {
          instituteName = "Kantar";
        } else if (href.includes("allensbach")) {
          instituteName = "Allensbach";
        } else if (href.includes("dimap")) {
          instituteName = "Infratest dimap";
        } else if (href.includes("gms")) {
          instituteName = "GMS";
        } else if (href.includes("verian") || href.includes("emnid")) {
          instituteName = "Verian (Emnid)";
        }
      
        instituteLink = href;
      }

      institute = { name: instituteName, link: instituteLink };
  
      const date = dates[colIndex];
      if (!date?.parsed) return;
  
      const valueText = $(cell).text().trim().replace(",", ".");
      const value = parseFloat(valueText);
      if (isNaN(value)) return;
  
      const pollKey = `${institute.name}_${date.parsed}`;
  
      if (!state[pollKey]) {
        state[pollKey] = {
          institute: institute.name,
          link: `https://www.wahlrecht.de/umfragen/${institute.link}`,
          published: date.parsed,
          results: {},
        };
      }
  
      state[pollKey].results[party] = value;
    });
  }  

  // ✅ Detect new or updated polls correctly
  const prevState = await loadState();
  for (const [pollKey, pollData] of Object.entries(state)) {
    if (!prevState[pollKey] ||
        JSON.stringify(prevState[pollKey].results) !== JSON.stringify(pollData.results)) {
      updated.push(pollData);
    }
  }

  if (Object.keys(state).length > 0) {
    await saveState(state);
    console.log(`💾 Updated state with ${Object.keys(state).length} polls stored`);
  }

  return updated;
}
