import { initializeReport } from "./client.js";

initializeReport(document);
document
  .querySelector("html")
  ?.style.setProperty("--interactive-display", "inline-flex");
