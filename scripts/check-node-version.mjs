const major = Number.parseInt(process.versions.node.split(".", 1)[0], 10);

if (major !== 25) {
  console.error(
    `Moneyman requires Node.js 25; received ${process.version}. ` +
      "Node 26 is blocked because Telegram multipart uploads do not complete.",
  );
  process.exit(1);
}
