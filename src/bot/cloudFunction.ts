import { runWithStorage } from "./index.js";
import { RunnerHooks } from "../types.js";

// Import the runScraper function from the main entry point
import { runScraper } from "../index.js";

// Google Cloud Function HTTP handler
export const scheduledScrape = async (req, res) => {
    try {
        // Run the main scraping logic
        await runWithStorage(runScraper);
        res.status(200).send("Scrape completed");
    } catch (e) {
        res.status(500).send("Error: " + (e?.message || e));
    }
}; 