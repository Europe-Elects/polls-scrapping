# Polls Scrapping - Azure Functions

Automated polling data scraper that monitors election polls and sends notifications to Slack.

## Current Functions

### GetNewPolls (Germany 🇩🇪)
- **Schedule:** Every 6 hours
- **Source:** [wahlrecht.de](https://www.wahlrecht.de/umfragen/)
- **Monitors:** 8 polling institutes (Allensbach, Verian, Forsa, Forschungsgruppe Wahlen, GMS, Infratest dimap, INSA, Yougov)
- **State Storage:** `state-de.json` in Azure Blob Storage
- **Notification:** Slack webhook (`SLACK_WEBHOOK`)

### GetNewPollsRO (Romania 🇷🇴)
- **Schedule:** Every 6 hours
- **Source:** [Wikipedia - Romanian Parliamentary Elections 2028](https://ro.wikipedia.org/wiki/Alegeri_parlamentare_%C3%AEn_Rom%C3%A2nia,_2028#Sondaje_de_opinie)
- **State Storage:** `state-ro.json` in Azure Blob Storage
- **Notification:** Slack webhook (`SLACK_WEBHOOK_RO`)

## Azure Setup

### Required Resources
- **Azure Function App** (Node.js 20, Linux Consumption Plan)
- **Azure Storage Account** (for state persistence)
- **Application Settings:**
  ```
  FUNCTIONS_WORKER_RUNTIME=node
  SLACK_WEBHOOK=<your-webhook-url>
  SLACK_WEBHOOK_RO=<your-webhook-url>
  STORAGE_ACCOUNT_CONNECTION_STRING=<connection-string>
  STATE_CONTAINER_NAME=<container-name>
  STATE_BLOB_DE=state-de.json
  STATE_BLOB_RO=state-ro.json
  ```

### Deployment

**CLI:**
```bash
func azure functionapp publish polls-de-scrape --javascript
```

**GitHub Actions:**
- Triggers on push to `main` branch
- Requires `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` secret
- Deploys both functions in a single operation

## Adding a New Country

### 1. Create Scraper Module
Create `polls-{country}.js` in the root directory:

```javascript
import { BlobServiceClient } from "@azure/storage-blob";
import axios from "axios";
import * as cheerio from "cheerio";

const CONN_STRING = process.env.STORAGE_ACCOUNT_CONNECTION_STRING;
const CONTAINER = process.env.STATE_CONTAINER_NAME;
const BLOB_NAME = process.env.STATE_BLOB_XX || "state-xx.json";

const blobService = BlobServiceClient.fromConnectionString(CONN_STRING);
const containerClient = blobService.getContainerClient(CONTAINER);
const blobClient = containerClient.getBlockBlobClient(BLOB_NAME);

async function loadState() {
  // Load previous state from blob storage
}

async function saveState(state) {
  // Save state to blob storage
}

export default async function scrapeCountry() {
  const prev = await loadState();
  const updated = [];
  
  // Scrape website for polls
  // Compare with previous state
  // Return only new/changed polls
  
  await saveState(newState);
  return updated;
}
```

### 2. Create Function Directory
Create `GetNewPolls{Country}/` folder with:

**function.json:**
```json
{
  "bindings": [
    {
      "name": "myTimer",
      "type": "timerTrigger",
      "direction": "in",
      "schedule": "0 0 */6 * * *"
    }
  ]
}
```

**index.js:**
```javascript
import scrapeCountry from "../polls-xx.js";

const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_XX;

export default async function (context, myTimer) {
  context.log("🇽🇽 Checking Country polls...");
  const polls = await scrapeCountry();

  if (!polls.length) {
    context.log("✅ No new polls");
    return;
  }

  for (const p of polls) {
    const text = `🇽🇽 *New Poll: ${p.institute}*\n📅 ${p.published}\n` +
      // Format results
      `\n🔗 ${p.link}`;

    await fetch(SLACK_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
  }

  context.log("✅ Poll notification complete");
}
```

### 3. Add Environment Variables
In Azure Portal → Function App → Configuration:
- `SLACK_WEBHOOK_XX=<webhook-url>`
- `STATE_BLOB_XX=state-xx.json`

### 4. Deploy
```bash
npm install  # If new dependencies were added
func azure functionapp publish polls-de-scrape --javascript
```

## State Management

Each country maintains its own state file in Azure Blob Storage to track which polls have already been processed. The state is a JSON object keyed by `{institute}_{date}` containing the poll data.

## Development

**Local testing:**
```bash
npm install
func start
```

**Configure** `local.settings.json` with your environment variables before running locally.
