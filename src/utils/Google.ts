import { GoogleSpreadsheet } from "google-spreadsheet";
import { GoogleAuth } from "google-auth-library";

export async function getGoogleSheet(
  serviceAccountEmail: string,
  serviceAccountPrivateKey: string,
  sheetId: string,
) {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    credentials: {
      client_email: serviceAccountEmail,
      private_key: serviceAccountPrivateKey,
    },
  });

  const doc = new GoogleSpreadsheet(sheetId, auth);
  await doc.loadInfo();
  return doc;
}

export async function exportGSheetToCSV(
  serviceAccountEmail: string | undefined,
  serviceAccountPrivateKey: string | undefined,
  sheetId: string | undefined,
  worksheetName: string | undefined,
): Promise<string> {
  if (
    !serviceAccountEmail ||
    !serviceAccountPrivateKey ||
    !sheetId ||
    !worksheetName
  ) {
    throw new Error("All google arguments must be passed");
  }
  try {
    const doc = await getGoogleSheet(
      serviceAccountEmail,
      serviceAccountPrivateKey,
      sheetId,
    );
    const sheet = doc.sheetsByTitle[worksheetName];
    if (!sheet) {
      throw new Error(`Sheet ${worksheetName} not found`);
    }
    const arrayBuffer = await sheet.downloadAsCSV();
    const csvData = arrayBufferToString(arrayBuffer);
    return csvData;
  } catch (error) {
    throw new Error(`Error exporting google sheet to CSV: ${error}`);
  }
}

function arrayBufferToString(buffer: ArrayBuffer): string {
  return new TextDecoder("utf-8").decode(new Uint8Array(buffer));
}
