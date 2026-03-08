import {
  type AcpxNdjsonEvent,
  parseAcpxNdjsonEvent,
} from "../models/AcpxEvent";

export type ParseAcpxNdjsonLineSuccess = {
  success: true;
  event: AcpxNdjsonEvent;
};

export type ParseAcpxNdjsonLineFailure = {
  success: false;
  rawLine: string;
};

export type ParseAcpxNdjsonLineResult =
  | ParseAcpxNdjsonLineSuccess
  | ParseAcpxNdjsonLineFailure;

/**
 * Parse a single line of acpx NDJSON output into a typed event.
 * Returns a discriminated union: success with the parsed event, or failure with the raw line.
 */
export const parseAcpxNdjsonLine = (
  line: string,
): ParseAcpxNdjsonLineResult => {
  const trimmed = line.trim();
  if (trimmed === "") {
    return { success: false, rawLine: line };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { success: false, rawLine: line };
  }

  const result = parseAcpxNdjsonEvent(parsed);
  if (result.success) {
    return { success: true, event: result.data };
  }

  return { success: false, rawLine: line };
};
