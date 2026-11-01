import { initializeReport } from "./client.js";

function reportFailure(error: unknown) {
  document.documentElement.classList.remove("report-interactive");
  dispatchEvent(new ErrorEvent("error", { error }));
}

addEventListener("unhandledrejection", (event) => {
  reportFailure(event.reason);
  event.preventDefault();
});

initializeReport(document).then(
  () => document.documentElement.classList.add("report-interactive"),
  reportFailure,
);
