/**
 * Common types shared across packages
 */

import type { CompanyTypes } from "israeli-bank-scrapers";

/**
 * Type for images with captions, used for failure screenshots
 */
export type ImageWithCaption = {
  photoPath: string;
  caption: string;
};

/**
 * Type for run metadata
 */
export type RunMetadata = {
  domainsByCompany: Partial<Record<CompanyTypes | "infra", unknown>>;
  networkInfo: unknown;
  metadataLogEntries: Array<string>;
};
