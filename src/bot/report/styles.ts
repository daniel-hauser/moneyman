const css = (strings: TemplateStringsArray, ...values: string[]) =>
  String.raw({ raw: strings }, ...values).trim();

export const reportStyles = css`
  body {
    font:
      16px system-ui,
      sans-serif;
    line-height: 1.5;
    max-width: 960px;
    margin: 2rem auto;
    padding: 0 1rem;
    color: #202124;
  }
  h1,
  h2 {
    line-height: 1.2;
  }
  .status {
    display: inline-block;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
  }
  .status.failed {
    background: #fde8e7;
    color: #a50e0e;
  }
  .status.succeeded {
    background: #e6f4ea;
    color: #137333;
  }
  section {
    margin: 2rem 0;
  }
  details {
    margin: 0.75rem 0;
    padding: 0.75rem;
    border: 1px solid #dadce0;
    border-radius: 0.5rem;
  }
  summary {
    cursor: pointer;
    font-weight: 600;
  }
  .run-details,
  .storage-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
    gap: 0.75rem;
  }
  .run-details > div,
  .storage-stats > div,
  .account-result,
  .storage-result {
    min-width: 0;
    padding: 0.75rem;
    border: 1px solid #dadce0;
    border-radius: 0.5rem;
  }
  .run-details dt,
  .storage-stats dt {
    font-weight: 600;
  }
  .run-details dd,
  .storage-stats dd {
    margin: 0.25rem 0 0;
  }
  .report-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
    gap: 0.75rem;
  }
  .report-grid h3,
  .report-grid h4 {
    margin-top: 0;
  }
  .storage-state {
    margin-top: -0.75rem;
  }
  .scraper-status,
  .account-result ul,
  .storage-result ul {
    padding-left: 1.5rem;
  }
  .table-wrapper {
    max-width: 100%;
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    white-space: nowrap;
  }
  th,
  td {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #dadce0;
    text-align: left;
  }
  td:nth-child(4) {
    white-space: normal;
    min-width: 12rem;
  }
  .screenshots {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 180px), 1fr));
    gap: 0.75rem;
  }
  .screenshot {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    border: 1px solid #dadce0;
    border-radius: 0.5rem;
  }
  .screenshot a {
    display: block;
  }
  .screenshot img {
    display: block;
    width: 100%;
    height: 140px;
    object-fit: cover;
  }
  .screenshot figcaption {
    padding: 0.5rem 0.75rem;
    overflow-wrap: anywhere;
  }
  .error-message {
    max-width: 100%;
    overflow-x: auto;
    white-space: pre;
  }
  .run-logs {
    height: 24rem;
    overflow: auto;
    white-space: pre;
    content-visibility: auto;
    contain-intrinsic-size: auto 24rem;
  }
`;
