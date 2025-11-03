import { BlobServiceClient } from "@azure/storage-blob";
import axios from "axios";
import cheerio from "cheerio";

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


// ✅ Your existing scraper function
export default async function scrapeWahlrecht() {
  const state = await loadState();
  const updated = [];

  const { data } = await axios.get("https://www.wahlrecht.de/umfragen/");
  const $ = cheerio.load(data);

  const dateRow = $("#datum td.di, #datum td.dir");
  dateRow.each((index, el) => {
    const instituteHeader = $("thead th.in").eq(index);
    const institute = instituteHeader.text().trim().replace(/\s+/g, "");
    const publishedText = $(el).text().trim();
    const published = new Date(publishedText).toISOString().slice(0, 10);
    const link = new URL(instituteHeader.find("a")?.attr("href") || "", "https://www.wahlrecht.de/umfragen/").href;

    if (!state[institute] || state[institute].published !== published) {
      updated.push({ institute, published, link });
      state[institute] = { published, link };
    }
  });

  if (updated.length > 0) await saveState(state);

  return updated;
}
