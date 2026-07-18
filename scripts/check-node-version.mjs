const major = Number.parseInt(process.versions.node.split(".", 1)[0], 10);

if (major < 24 || major >= 26) {
  console.error(
    `Moneyman requires Node.js 24 or 25; received ${process.version}. ` +
      "Node 26 is blocked because Telegram multipart uploads do not complete.",
  );
  process.exit(1);
}
