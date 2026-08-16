import type { ExecResult, TranscriptCell } from '../types';
import type { CellBlockProps } from './CellBlock';

/** Map a transcript cell (error is a string) to the CellBlock props. */
export function transcriptCellProps(cell: TranscriptCell): CellBlockProps {
  return {
    code: cell.code,
    stdout: cell.stdout,
    stderr: cell.stderr,
    resultRepr: cell.resultRepr,
    errorMessage: cell.error,
    errorTraceback: [],
    durationMs: cell.durationMs,
    timestamp: cell.timestamp,
  };
}

/** Map a manual kernel ExecResult (error is a KernelError object) to CellBlock props. */
export function execResultProps(code: string, result: ExecResult): CellBlockProps {
  return {
    code,
    stdout: result.stdout,
    stderr: result.stderr,
    resultRepr: result.resultRepr,
    errorMessage: result.error !== null ? result.error.message : null,
    errorTraceback: result.error !== null ? result.error.traceback : [],
    durationMs: result.durationMs,
  };
}
