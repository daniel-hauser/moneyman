import { escapers } from "@telegraf/entity";
import { html } from "./html.js";

export function renderReportErrors(
  errors: Array<{ caller: string; message: string }>,
) {
  if (!errors.length) return "";

  return html`<section>
    <h2>Errors</h2>
    <ul>
      ${errors
        .map(
          ({ caller, message }) =>
            html`<li>
              <strong>${escapers.HTML(caller)}</strong>
              <pre>${escapers.HTML(message)}</pre>
            </li>`,
        )
        .join("")}
    </ul>
  </section>`;
}

export function renderReportScreenshots(
  screenshots: Array<{ caption: string; dataUrl: string }>,
) {
  if (!screenshots.length) return "";

  return html`<section>
    <h2>Screenshots</h2>
    <div class="screenshots">
      ${screenshots
        .map(
          ({ caption, dataUrl }) =>
            html`<figure class="screenshot">
              <a
                href="${escapers.HTML(dataUrl)}"
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  src="${escapers.HTML(dataUrl)}"
                  alt="${escapers.HTML(caption)}"
                />
              </a>
              <figcaption>${escapers.HTML(caption)}</figcaption>
            </figure>`,
        )
        .join("")}
    </div>
  </section>`;
}
