// Thin wrappers around the database functions in supabase/002_results_import.sql.
// Flow: parse the CSV (importRace / importPoints) -> show the preview -> stage -> publish.
// Staging saves the rows UNPUBLISHED; the public only sees them after publishImport().
import type { SupabaseClient } from "@supabase/supabase-js";

// Any Supabase client, whichever database schema it was created for (ours uses "aptiming").
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;
import type { RaceImportResult } from "./importRace";
import type { ImportResult } from "./importPoints";

// "Race 6" -> 6 (returns null when the file name had no race number)
export function raceNumberFromLabel(label: string): number | null {
  const m = label.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

export async function stageRaceImport(
  supabase: AnyClient,
  eventId: string,
  filename: string,
  result: RaceImportResult,
  raceNumber?: number            // pass this when the file name had no race number
): Promise<string> {
  if (result.errors.length) throw new Error("Fix the file errors before importing.");
  const n = raceNumber ?? raceNumberFromLabel(result.raceLabel);
  if (n === null) throw new Error("Choose which race this file is for.");
  const { data, error } = await supabase.rpc("stage_race_import", {
    p_event: eventId,
    p_race_number: n,
    p_filename: filename,
    p_rows: result.rows,
    p_warnings: result.warnings,
  });
  if (error) throw new Error(error.message);
  return data as string;         // import id
}

export async function stagePointsImport(
  supabase: AnyClient,
  eventId: string,
  filename: string,
  result: ImportResult
): Promise<string> {
  if (result.errors.length) throw new Error("Fix the file errors before importing.");
  const { data, error } = await supabase.rpc("stage_points_import", {
    p_event: eventId,
    p_filename: filename,
    p_rows: result.rows,
    p_warnings: result.warnings,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

// Makes a staged import public. Replaces earlier published rows for the same race
// (or the same classes, for points), including live provisional rows.
export async function publishImport(supabase: AnyClient, importId: string): Promise<void> {
  const { error } = await supabase.rpc("publish_import", { p_import: importId });
  if (error) throw new Error(error.message);
}
