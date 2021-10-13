import "dotenv/config";

console.log(
  Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) =>
      k.toLowerCase().startsWith("m_")
    )
  )
);
